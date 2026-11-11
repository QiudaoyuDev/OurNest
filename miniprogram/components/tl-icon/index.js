const ICON_GLYPHS = require("./glyphs");
const CATEGORY_ICONS = require("./category-icons");

const COLOR_KEY_MAP = {
  primary: "#F0442F",
  primaryDark: "#D9483B",
  income: "#25A66A",
  incomeOld: "#2F9D68",
  muted: "#9A8278",
  mutedText: "#7F6C65",
  tabInactive: "#B39A90",
  white: "#FFFFFF",
  warning: "#E76A53",
  iconUnselected: "#6F5A52",
};

Component({
  properties: {
    name: {
      type: String,
      value: "add-line",
      observer(name) {
        this.updateGlyph(name);
      },
    },
    size: {
      type: Number,
      value: 32,
    },
    color: {
      type: String,
      value: "",
    },
    colorKey: {
      type: String,
      value: "",
    },
  },

  data: {
    glyph: "",
    categoryPath: "",
    categoryImage: "",
    resolvedColor: "currentColor",
  },

  lifetimes: {
    attached() {
      this.updateGlyph(this.data.name);
      this.updateColor();
    },
  },

  observers: {
    "color, colorKey"() {
      this.updateColor();
    },
  },

  methods: {
    updateGlyph(name) {
      const categoryPath = CATEGORY_ICONS[name] || "";
      if (categoryPath !== this.data.categoryPath) this.setData({ categoryPath });
      const codePoint = ICON_GLYPHS[name];
      const glyph = codePoint ? String.fromCodePoint(codePoint) : "";
      if (glyph !== this.data.glyph) this.setData({ glyph });
      this.updateCategoryImage(categoryPath, this.data.resolvedColor);
    },
    updateCategoryImage(path, color) {
      const stroke = /^#[0-9a-f]{3,8}$/i.test(color) ? color : "#6F5A52";
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
      this.setData({ categoryImage: path ? `data:image/svg+xml,${encodeURIComponent(svg)}` : "" });
    },
    updateColor() {
      const key = this.data.colorKey;
      const direct = this.data.color;
      const resolved = COLOR_KEY_MAP[key] || direct || "currentColor";
      if (resolved !== this.data.resolvedColor) this.setData({ resolvedColor: resolved });
      this.updateCategoryImage(this.data.categoryPath, resolved);
    },
  },
});
