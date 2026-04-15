const mongoose = require('mongoose');

const bookmarkSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  gutenbergId: {
    type: Number,
    required: true
  },
  title: {
    type: String,
    required: true
  },
  author: {
    type: String
  },
  coverUrl: {
    type: String
  },
  savedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Composite unique index
bookmarkSchema.index({ userId: 1, gutenbergId: 1 }, { unique: true });

// Map _id to id
bookmarkSchema.virtual('id').get(function() {
  return this._id.toHexString();
});

module.exports = mongoose.model('Bookmark', bookmarkSchema);
