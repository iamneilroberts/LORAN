"""
The feed normalisers are where upstream's shape becomes ours, so they are where a wrong
assumption turns into wrong data on the globe rather than an exception.

Every case here is a documented trap from docs/data-sources.md or CLAUDE.md, not an invented
edge: the `"ground"` string, the dbFlags bitfield, geometric-over-barometric altitude, legitimate
negative altitudes, and the fields adsb.lol simply does not send.
"""
from app.feeds.adsb import normalize
from app.feeds.adsbdb import normalize_route
from app.feeds.planespotters import POISONED_HEX, normalize_photo


def ac(**over):
    """A realistic readsb record; override just the field under test."""
    base = {
        "hex": "A39DCA",
        "flight": "FFT1257 ",
        "lat": 30.6944,
        "lon": -88.0399,
        "alt_baro": 30000,
        "alt_geom": 30575,
        "gs": 450.2,
        "track": 217.4,
        "squawk": "1200",
        "dbFlags": 0,
    }
    base.update(over)
    return base


class TestNormalizeAircraft:
    def test_drops_a_record_with_no_position(self):
        # No position means nothing to draw. Returning a partial record would put a contact
        # at (0, 0) in the Gulf of Guinea.
        assert normalize(ac(lat=None, lon=None)) is None
        assert normalize(ac(lat=30.0, lon=None)) is None
        assert normalize({}) is None

    def test_prefers_geometric_altitude_for_positioning(self):
        # alt_geom is WGS84 and is what Cesium wants for height above the ellipsoid.
        out = normalize(ac(alt_baro=30000, alt_geom=30575))
        assert out["alt_ft"] == 30575
        assert out["alt_geom_ft"] == 30575
        assert out["alt_baro_ft"] == 30000

    def test_falls_back_to_barometric_when_geometric_is_absent(self):
        out = normalize(ac(alt_geom=None))
        assert out["alt_ft"] == 30000

    def test_handles_the_literal_string_ground(self):
        # alt_baro can be the STRING "ground" rather than a number. Treating it as a number
        # is the documented way to get a NaN altitude onto the globe.
        out = normalize(ac(alt_baro="ground", alt_geom=None))
        assert out["on_ground"] is True
        assert out["alt_ft"] == 0.0
        assert out["alt_baro_ft"] is None

    def test_ground_contact_still_prefers_a_real_geometric_altitude(self):
        out = normalize(ac(alt_baro="ground", alt_geom=42.0))
        assert out["on_ground"] is True
        assert out["alt_ft"] == 42.0

    def test_keeps_negative_altitudes(self):
        # Legitimate: below-sea-level airfields, and barometric error near the surface.
        out = normalize(ac(alt_baro=-75, alt_geom=None))
        assert out["alt_ft"] == -75
        assert out["on_ground"] is False

    def test_decodes_dbflags_as_a_bitfield_not_an_enum(self):
        # 1 = military, 4 = PIA, 8 = LADD, and they combine.
        assert normalize(ac(dbFlags=1))["military"] is True
        assert normalize(ac(dbFlags=8))["ladd"] is True
        assert normalize(ac(dbFlags=4))["pia"] is True

        both = normalize(ac(dbFlags=9))
        assert both["military"] is True and both["ladd"] is True

        # 2 = "interesting" and must not be mistaken for military.
        assert normalize(ac(dbFlags=2))["military"] is False

        none = normalize(ac(dbFlags=0))
        assert (none["military"], none["ladd"], none["pia"]) == (False, False, False)

    def test_missing_dbflags_is_not_military(self):
        out = normalize(ac(dbFlags=None))
        assert out["military"] is False

    def test_lowercases_hex_and_strips_the_callsign(self):
        # The feed pads callsigns to 8 chars; the hex case varies by source.
        out = normalize(ac(hex="A39DCA", flight="FFT1257 "))
        assert out["hex"] == "a39dca"
        assert out["flight"] == "FFT1257"

    def test_blank_callsign_becomes_none_not_empty_string(self):
        # An em-dash is the honest render for unknown; "" would print as nothing at all.
        assert normalize(ac(flight="        "))["flight"] is None
        assert normalize(ac(flight=""))["flight"] is None

    def test_tolerates_the_fields_adsb_lol_omits(self):
        # adsb.lol sends no desc/ownOp/year. Those must come back None, not KeyError.
        thin = {"hex": "abc123", "lat": 30.0, "lon": -88.0}
        out = normalize(thin)
        assert out is not None
        assert out["desc"] is None and out["operator"] is None and out["year"] is None

    def test_normalises_the_emergency_sentinel(self):
        # "none" is upstream's way of saying no emergency; passing it through would light up
        # the dossier for every ordinary contact.
        assert normalize(ac(emergency="none"))["emergency"] is None
        assert normalize(ac(emergency=None))["emergency"] is None
        assert normalize(ac(emergency="7700"))["emergency"] == "7700"

    def test_rejects_non_numeric_values_rather_than_crashing(self):
        out = normalize(ac(gs="fast", track=None))
        assert out["gs_kt"] is None
        assert out["track_deg"] is None


class TestNormalizeRoute:
    def test_carries_airport_coordinates_through(self):
        # D-050's destination line depends entirely on these two fields being present.
        out = normalize_route({
            "callsign": "FFT1257",
            "airline": {"name": "Frontier"},
            "origin": {"icao_code": "KMOB", "iata_code": "MOB", "name": "Mobile Rgnl",
                       "municipality": "Mobile", "latitude": 30.6912, "longitude": -88.2428},
            "destination": {"icao_code": "KLAS", "iata_code": "LAS", "name": "Harry Reid",
                            "municipality": "Las Vegas", "latitude": 36.0801,
                            "longitude": -115.152},
        })
        assert out["destination"]["lat"] == 36.0801
        assert out["destination"]["lon"] == -115.152
        assert out["destination"]["icao"] == "KLAS"
        assert out["origin"]["municipality"] == "Mobile"

    def test_missing_airport_becomes_none_not_a_hollow_dict(self):
        # The destination line must draw nothing rather than guess at an airport.
        out = normalize_route({"callsign": "X", "origin": None, "destination": None})
        assert out["origin"] is None
        assert out["destination"] is None

    def test_airport_without_coordinates_yields_none_coordinates(self):
        out = normalize_route({"destination": {"icao_code": "KLAS"}})
        assert out["destination"]["icao"] == "KLAS"
        assert out["destination"]["lat"] is None
        assert out["destination"]["lon"] is None


class TestNormalizePhoto:
    def test_passes_urls_through_untouched(self):
        # Rewriting a planespotters URL - even swapping a size suffix - is forbidden by
        # their terms (D-009). This asserts we hand back exactly what they published.
        src = "https://t.plnspttrs.net/12345/987654_1a2b3c_2.jpg"
        link = "https://www.planespotters.net/photo/987654/n637nn"
        out = normalize_photo({
            "thumbnail_large": {"src": src, "size": {"width": 1024, "height": 683}},
            "link": link,
            "photographer": "Tran Nguyen An Binh",
        })
        assert out["src"] == src
        assert out["link"] == link
        assert out["width"] == 1024 and out["height"] == 683

    def test_returns_none_without_a_usable_thumbnail_or_link(self):
        assert normalize_photo({}) is None
        assert normalize_photo({"thumbnail_large": {"src": "x"}}) is None
        assert normalize_photo({"link": "https://example.com"}) is None

    def test_falls_back_to_the_small_thumbnail(self):
        out = normalize_photo({
            "thumbnail": {"src": "https://t.plnspttrs.net/small.jpg"},
            "link": "https://www.planespotters.net/photo/1",
        })
        assert out["src"] == "https://t.plnspttrs.net/small.jpg"
        # Unknown dimensions stay None rather than being guessed.
        assert out["width"] is None and out["height"] is None

    def test_poisoned_hexes_are_the_documented_set(self):
        # These transponder hexes return a real photo of the WRONG aircraft, which is the
        # worst possible failure for this project: confident, plausible, and false.
        assert POISONED_HEX == {"000000", "000001", "FFFFFD", "FFFFFE", "FFFFFF"}
