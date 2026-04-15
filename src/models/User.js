const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  passwordHash: {
    type: String
  },
  googleId: {
    type: String,
    unique: true,
    sparse: true // Allows null/missing values while still enforcing uniqueness for non-null ones
  },
  avatar: {
    type: String
  },
  preferences: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Map MongoDB's _id to id for compatibility with existing code
userSchema.virtual('id').get(function() {
  return this._id.toHexString();
});

module.exports = mongoose.model('User', userSchema);
