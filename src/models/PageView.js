const mongoose = require('mongoose');

// One document per post per day: cheap to increment, easy to chart.
const pageViewSchema = new mongoose.Schema({
  post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
  day: { type: String, required: true }, // YYYY-MM-DD
  count: { type: Number, default: 0 },
});

pageViewSchema.index({ post: 1, day: 1 }, { unique: true });
pageViewSchema.index({ day: 1 });

module.exports = mongoose.model('PageView', pageViewSchema);
