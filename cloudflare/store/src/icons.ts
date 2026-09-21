// Known icon names (spec/icons.json), passed to the SDK validators so manifest/screen icon
// names are checked the same way `tools/validate` checks them.
import iconsDoc from "../../../spec/icons.json";

export const ICON_NAMES: readonly string[] = iconsDoc.icons;
