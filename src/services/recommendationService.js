// src/services/recommendationService.js
// ─────────────────────────────────────────────────────────────────────────────
// BOOK RECOMMENDATION ENGINE
//
// This generates personalized book recommendations based on a user's
// reading history. It uses a simple but effective content-based filtering
// approach:
//
//   1. Look at what subjects/genres the user has read
//   2. Count which subjects appear most frequently (their "taste profile")
//   3. Find books from the Gutenberg API that match those subjects
//   4. Filter out books they've already read
//   5. Rank results by how well they match the user's taste
//
// This is called "content-based filtering" — we recommend based on
// the content attributes (subjects) of books the user liked.
// ─────────────────────────────────────────────────────────────────────────────

const { ReadingHistory } = require('../utils/db');
const { getBooksBySubjects } = require('./gutenbergService');

/**
 * getUserTasteProfile — Analyze a user's reading history to understand their preferences
 *
 * Returns a "taste profile": an object mapping each subject to how often
 * the user has read books with that subject.
 *
 * Example output:
 *   { "Fiction": 8, "Romance": 5, "Adventure": 3, "Mystery": 2 }
 *
 * @param {number} userId
 * @returns {Object} subjectFrequency map
 */
async function getUserTasteProfile(userId) {
  // Get the user's reading history
  const history = await ReadingHistory.find({ userId })
    .select('subjects rating completed');

  if (history.length === 0) return {};

  // Count subject frequencies, giving more weight to:
  // - Completed books (they finished it = they liked it)
  // - Highly rated books
  const subjectFreq = {};

  for (const record of history) {
    // Weight: completed books count double, ratings add extra weight
    let weight = 1;
    if (record.completed) weight += 1;
    if (record.rating)    weight += record.rating - 3; // 5-star adds 2, 1-star subtracts 2

    for (const subject of (record.subjects || [])) {
      // Normalize the subject: lowercase, trimmed
      const normalized = subject.toLowerCase().trim();
      subjectFreq[normalized] = (subjectFreq[normalized] || 0) + weight;
    }
  }

  return subjectFreq;
}

/**
 * getTopSubjects — Get the N most frequent subjects from a taste profile
 * @param {Object} tasteProfile - Output of getUserTasteProfile
 * @param {number} n - How many top subjects to return
 * @returns {string[]}
 */
function getTopSubjects(tasteProfile, n = 3) {
  return Object.entries(tasteProfile)
    .sort(([, a], [, b]) => b - a) // Sort by frequency (highest first)
    .slice(0, n)
    .map(([subject]) => subject);
}

/**
 * getRecommendations — Main function: get book recommendations for a user
 *
 * @param {number} userId - The user to recommend for
 * @param {number} limit  - How many recommendations to return
 * @returns {Array} Array of recommended books with a "reason" field explaining why
 */
async function getRecommendations(userId, limit = 12) {
  try {
    // Step 1: Get the user's reading history (just the Gutenberg IDs)
    const history = await ReadingHistory.find({ userId })
      .select('gutenbergId subjects');

    // If no reading history, return popular books instead
    if (history.length === 0) {
      return getPopularBooks();
    }

    // Step 2: Build a set of already-read book IDs (to exclude from recommendations)
    const alreadyReadIds = new Set(history.map(h => h.gutenbergId));

    // Step 3: Get user's taste profile
    const tasteProfile = await getUserTasteProfile(userId);
    const topSubjects  = getTopSubjects(tasteProfile, 3);

    if (topSubjects.length === 0) {
      return getPopularBooks();
    }

    // Step 4: Fetch books from Gutenberg API that match top subjects
    const candidateBooks = await getBooksBySubjects(topSubjects, 50);

    // Step 5: Filter out already-read books
    const newBooks = candidateBooks.filter(book => !alreadyReadIds.has(book.id));

    // Step 6: Score each candidate book by how well it matches the taste profile
    const scoredBooks = newBooks.map(book => {
      const bookSubjects = (book.subjects || []).map(s => s.toLowerCase());
      let score = 0;

      // Add points for each subject the user likes
      for (const subject of bookSubjects) {
        // Check for partial matches too (e.g., "detective fiction" matches "fiction")
        for (const [profileSubject, freq] of Object.entries(tasteProfile)) {
          if (subject.includes(profileSubject) || profileSubject.includes(subject)) {
            score += freq;
          }
        }
      }

      // Generate a human-readable reason for the recommendation
      const matchedSubjects = topSubjects
        .filter(s => bookSubjects.some(bs => bs.includes(s) || s.includes(bs)))
        .slice(0, 2);

      const reason = matchedSubjects.length > 0
        ? `Because you read ${matchedSubjects.join(' & ')} books`
        : 'Highly popular in your reading genres';

      return { ...book, _score: score, _reason: reason };
    });

    // Step 7: Sort by score (best match first) and return top N
    return scoredBooks
      .sort((a, b) => b._score - a._score)
      .slice(0, limit);

  } catch (err) {
    console.error('Recommendation engine error:', err);
    return getPopularBooks(); // Fall back to popular books on error
  }
}

/**
 * getPopularBooks — Fallback: return popular books for new users with no history
 */
async function getPopularBooks() {
  try {
    const { searchBooks } = require('./gutenbergService');
    const data = await searchBooks({ query: '', lang: 'en' });
    return (data.results || []).slice(0, 12).map(book => ({
      ...book,
      _reason: 'Popular on Project Gutenberg'
    }));
  } catch (err) {
    return [];
  }
}

module.exports = { getRecommendations, getUserTasteProfile, getTopSubjects };
