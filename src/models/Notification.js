const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['reminder', 'recommendation', 'achievement', 'system'],
    required: true
  },
  title: {
    type: String,
    required: true
  },
  body: {
    type: String,
    required: true
  },
  read: {
    type: Boolean,
    default: false,
    index: true
  },
  link: {
    type: String
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Composite index for efficient filtering by user and read status
notificationSchema.index({ userId: 1, read: 1 });

// Map _id to id
notificationSchema.virtual('id').get(function() {
  return this._id.toHexString();
});

module.exports = mongoose.model('Notification', notificationSchema);
