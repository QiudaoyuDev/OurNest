Component({
  properties: {
    record: { type: Object, value: {} },
    type: { type: String, value: "expense" },
    rank: { type: Number, value: 0 },
    preferNote: { type: Boolean, value: false },
  },
  methods: {
    open() {
      this.triggerEvent("open", { id: this.data.record._id || this.data.record.id });
    },
  },
});
