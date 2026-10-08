const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema(
  {
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    email: { type: String, trim: true, lowercase: true, maxlength: 120 },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
    status: { type: String, enum: ['pending', 'approved', 'spam'], default: 'pending', index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Comment', commentSchema);
