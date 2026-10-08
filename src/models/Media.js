const mongoose = require('mongoose');

// Files are stored in MongoDB so they survive restarts on hosts with ephemeral disks (e.g. Render free tier).
const mediaSchema = new mongoose.Schema(
  {
    filename: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    alt: { type: String, default: '', maxlength: 200 },
    data: { type: Buffer, required: true, select: false },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

mediaSchema.virtual('url').get(function url() {
  return `/media/${this._id}`;
});

module.exports = mongoose.model('Media', mediaSchema);
