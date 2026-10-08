const mongoose = require('mongoose');

// A snapshot of a post's editable fields, saved on every edit so any version can be restored.
const revisionSchema = new mongoose.Schema(
  {
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true, index: true },
    version: { type: Number, required: true },
    title: String,
    excerpt: String,
    content: String,
    tags: [String],
    seo: { metaTitle: String, metaDescription: String, focusKeyword: String },
    status: String,
    editedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    note: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

module.exports = mongoose.model('Revision', revisionSchema);
