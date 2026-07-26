/**
 * The one property the owner called non-negotiable: a filter that hides traffic must never
 * itself disappear when the panel collapses. These tests hold `trafficPanelSections` to that,
 * plus the two claims needed to make the first one meaningful rather than trivially true - that
 * collapse actually hides something, and that it is never triggered by contact count.
 */
import { describe, expect, it } from "vitest";

import { trafficPanelSections } from "./trafficCollapse";

describe("trafficPanelSections", () => {
  it("keeps the filter warning visible whether collapsed or expanded", () => {
    const expanded = trafficPanelSections({ collapsed: false, filtering: true, hasContacts: true });
    const collapsed = trafficPanelSections({ collapsed: true, filtering: true, hasContacts: true });
    expect(expanded.filterWarning).toBe(true);
    expect(collapsed.filterWarning).toBe(true);
  });

  it("hides the operator rows and filter buttons when collapsed, shows them expanded", () => {
    // Proves collapse actually does something. Without this, the test above would pass
    // trivially even if collapse were a no-op that never hid anything at all.
    expect(trafficPanelSections({ collapsed: true, filtering: false, hasContacts: true }).controls)
      .toBe(false);
    expect(trafficPanelSections({ collapsed: false, filtering: false, hasContacts: true }).controls)
      .toBe(true);
  });

  it("never collapses because of contact count", () => {
    // Zero contacts must not force the controls or SEA TRAFFIC shut on their own - only the
    // `collapsed` timer input may do that. A feed that goes quiet is not "tidied", it is empty,
    // and the two must stay visibly different.
    const zeroContactsExpanded =
      trafficPanelSections({ collapsed: false, filtering: false, hasContacts: false });
    expect(zeroContactsExpanded.controls).toBe(true);
    expect(zeroContactsExpanded.seaTraffic).toBe(true);
  });

  it("keeps the honest empty state visible whether collapsed or expanded", () => {
    const expanded = trafficPanelSections({ collapsed: false, filtering: false, hasContacts: false });
    const collapsed = trafficPanelSections({ collapsed: true, filtering: false, hasContacts: false });
    expect(expanded.emptyState).toBe(true);
    expect(collapsed.emptyState).toBe(true);
  });
});
