const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const ROLES = ['admin', 'editor', 'author'];

// Permission matrix: what each role is allowed to do.
const PERMISSIONS = {
  admin: ['publish', 'editAny', 'deleteAny', 'moderate', 'manageTaxonomy', 'manageUsers', 'manageMedia', 'viewAnalytics'],
  editor: ['publish', 'editAny', 'deleteAny', 'moderate', 'manageTaxonomy', 'manageMedia', 'viewAnalytics'],
  author: ['manageMedia'],
};

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 120 },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ROLES, default: 'author' },
    bio: { type: String, default: '', maxlength: 400 },
    active: { type: Boolean, default: true },
    lastLoginAt: Date,
  },
  { timestamps: true }
);

userSchema.methods.setPassword = async function setPassword(plain) {
  this.passwordHash = await bcrypt.hash(plain, 12);
};

userSchema.methods.checkPassword = function checkPassword(plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.methods.can = function can(permission) {
  return (PERMISSIONS[this.role] || []).includes(permission);
};

userSchema.statics.ROLES = ROLES;
userSchema.statics.PERMISSIONS = PERMISSIONS;

module.exports = mongoose.model('User', userSchema);
