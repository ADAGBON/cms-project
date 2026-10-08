const mongoose = require('mongoose');

// Workflow states. "scheduled" posts go live automatically once publishAt passes.
const STATUSES = ['draft', 'in_review', 'scheduled', 'published', 'archived'];
const LANGUAGES = ['en', 'fr', 'yo', 'ha', 'ig'];

const postSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    slug: { type: String, required: true, unique: true, index: true },
    excerpt: { type: String, default: '', maxlength: 400 },
    content: { type: String, default: '' }, // sanitized HTML
    coverImage: { type: String, default: '' },
    status: { type: String, enum: STATUSES, default: 'draft', index: true },
    publishAt: { type: Date, index: true },
    publishedAt: Date,
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
    tags: [{ type: String, lowercase: true, trim: true }],
    lang: { type: String, enum: LANGUAGES, default: 'en' },
    seo: {
      metaTitle: { type: String, default: '', maxlength: 70 },
      metaDescription: { type: String, default: '', maxlength: 170 },
      focusKeyword: { type: String, default: '', maxlength: 60 },
    },
    featured: { type: Boolean, default: false },
    allowComments: { type: Boolean, default: true },
    views: { type: Number, default: 0 },
    readingMinutes: { type: Number, default: 1 },
    version: { type: Number, default: 1 },
    reviewNote: { type: String, default: '' },
  },
  { timestamps: true }
);

postSchema.index({ status: 1, publishedAt: -1 });
postSchema.index({ tags: 1 });
postSchema.index({ category: 1, status: 1 });

// A post is visible to the public when published, or scheduled and its time has come.
postSchema.statics.liveFilter = function liveFilter(extra = {}) {
  return {
    ...extra,
    $or: [{ status: 'published' }, { status: 'scheduled', publishAt: { $lte: new Date() } }],
  };
};

postSchema.virtual('isLive').get(function isLive() {
  return this.status === 'published' || (this.status === 'scheduled' && this.publishAt && this.publishAt <= new Date());
});

postSchema.statics.STATUSES = STATUSES;
postSchema.statics.LANGUAGES = LANGUAGES;

module.exports = mongoose.model('Post', postSchema);
