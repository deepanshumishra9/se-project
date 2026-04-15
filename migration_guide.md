# Migration Guide: Prisma (PostgreSQL) to Mongoose (MongoDB)

This guide provides a step-by-step roadmap for migrating your ebook-library project from a relational database managed by Prisma to a document-oriented database using MongoDB and Mongoose.

## 1. Pre-Migration Checklist

Before you begin, ensure you have the following:
- [ ] **MongoDB Installed**: A local MongoDB instance or a [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) cluster.
- [ ] **MongoDB Compass**: Download and install [MongoDB Compass](https://www.mongodb.com/products/compass) for visual data management.
- [ ] **Data Backup**: If you have production data, export it to JSON or CSV. Prisma and MongoDB have different data structures, so automated migration of data involves custom scripts.
- [ ] **Environment Variables**: Update your `.env` file with a `MONGODB_URI`.

---

## 2. Dependency Changes

We need to swap out the Prisma-related packages for Mongoose and a MongoDB-compatible session store.

### Step 2.1: Uninstall Prisma and PostgreSQL utilities
```bash
npm uninstall prisma @prisma/client connect-pg-simple
```

### Step 2.2: Install Mongoose and MongoDB utilities
```bash
npm install mongoose connect-mongo
```

---

## 3. Schema/Model Conversion

In MongoDB, we use Mongoose Models instead of a static `schema.prisma` file.

### Prisma (Before)
```prisma
model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  username  String   @unique
  createdAt DateTime @default(now())
}
```

### Mongoose (After)
Create a new folder `src/models/` and define your schemas.

**`src/models/User.js`**
```javascript
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  username: { type: String, required: true, unique: true },
  passwordHash: String,
  googleId: { type: String, unique: true, sparse: true },
  avatar: String,
  preferences: { type: String, default: "{}" },
}, { timestamps: true });

// Virtual for id to match Prisma's output if needed
userSchema.virtual('id').get(function() {
  return this._id.toHexString();
});
userSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('User', userSchema);
```

> [!TIP]
> **IDs in MongoDB**: Unlike Prisma's auto-incrementing `Int`, MongoDB uses `ObjectId`. You likely won't need an `id` field in your Mongoose schema as Mongoose automatically creates `_id`.

---

## 4. Connection Configuration Update

Replace the content of `src/utils/db.js` to handle the Mongoose connection.

**`src/utils/db.js` (After)**
```javascript
const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = { connectDB };
```

Update `src/server.js` to call `connectDB()` before starting the server.

---

## 5. Query/Mutation Refactoring

You will need to replace Prisma calls with Mongoose equivalents throughout your services and routes.

| Operation | Prisma (Existing) | Mongoose (New) |
| :--- | :--- | :--- |
| **Find One** | `prisma.user.findUnique({ where: { id } })` | `User.findById(id)` |
| **Find Many** | `prisma.book.findMany({ where: { author: '...' } })` | `Book.find({ author: '...' })` |
| **Create** | `prisma.user.create({ data: { ... } })` | `User.create({ ... })` or `new User(...).save()` |
| **Update** | `prisma.user.update({ where: { id }, data: { ... } })` | `User.findByIdAndUpdate(id, { ... }, { new: true })` |
| **Delete** | `prisma.user.delete({ where: { id } })` | `User.findByIdAndDelete(id)` |
| **Relations** | `prisma.user.findUnique({ include: { history: true } })` | `User.findById(id).populate('history')` |

### Example Refactor (User Auth)
**Before (Prisma):**
```javascript
const user = await prisma.user.findUnique({
  where: { email: req.body.email }
});
```

**After (Mongoose):**
```javascript
const user = await User.findOne({ email: req.body.email });
```

---

## 6. Testing and Verification

To ensure no functionality is broken:
1. **Model Validation**: Ensure `required: true` and `unique: true` constraints in Mongoose match your Prisma schema.
2. **Session Persistence**: Verify login still works and sessions are stored in MongoDB via `connect-mongo`.
3. **Relation Integrity**: Test features like "Reading History" and "Bookmarks" to ensure the `userId` (now an `ObjectId`) correctly links records.
4. **API Responses**: Ensure that the internal change from `Int` to `ObjectId` is handled gracefully in your frontend templates (EJS).

---

## 7. Managing Data in MongoDB Compass

1. **Connect**: Open Compass and paste your connection string (`mongodb://localhost:27017` or Atlas URI).
2. **Database & Collections**: Your database will appear on the left. Each Prisma model is now a "Collection".
3. **CRUD Operations**:
   - **View**: Click a collection to see documents. Use the "Filter" bar to search (e.g., `{"email": "user@example.com"}`).
   - **Edit**: Hover over a document and click the Pencil icon to edit fields.
   - **Delete**: Click the Trash icon to remove a document.
   - **Schema Analysis**: Use the "Schema" tab to analyze data types across all documents.

---

> [!CAUTION]
> **Breaking Change Alert**: Because MongoDB uses `_id` and Prisma typically uses `id`, you may need to update your `.ejs` views if they specifically reference `user.id`. The virtual mapped in Step 3 helps mitigate this.
