const mongoose = require('mongoose');
const { makeSlug } = require('../utils/text');

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    slug: { type: String, unique: true, index: true },
    description: { type: String, default: '', maxlength: 300 },
  },
  { timestamps: true }
);

categorySchema.pre('validate', function setSlug() {
  if (!this.slug || this.isModified('name')) this.slug = makeSlug(this.name);
});

module.exports = mongoose.model('Category', categorySchema);
