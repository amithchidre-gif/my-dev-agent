/**
 * Lesson Deduplication - Prevents duplicate lessons from being stored
 * Hybrid approach: Jaccard similarity + keyword overlap + category matching
 */

// Stopwords to ignore in keyword extraction
const STOPWORDS = new Set([
  'the', 'in', 'after', 'a', 'an', 'to', 'for', 'of', 'on', 'at', 'by',
  'with', 'without', 'from', 'up', 'down', 'and', 'or', 'but', 'so', 'for',
  'nor', 'yet', 'is', 'are', 'was', 'were', 'be', 'been', 'being'
]);

// Word normalization (e.g., authentication → auth)
function normalizeWord(word) {
  const normalizations = {
    'authentication': 'auth',
    'authenticated': 'auth',
    'authenticate': 'auth',
    'validation': 'validate',
    'validated': 'validate',
    'validating': 'validate',
    'connection': 'conn',
    'connected': 'conn',
    'connecting': 'conn',
    'timeout': 'timeout',
    'timed': 'timeout',
    'failed': 'fail',
    'failing': 'fail',
    'failure': 'fail'
  };
  return normalizations[word] || word;
}

// Configuration
const DEDUP_CONFIG = {
  jaccardThreshold: 0.4,
  keywordOverlapMin: 2
};

// Extract meaningful keywords (remove stopwords, keep only words length > 2)
function extractKeywords(text) {
  const words = text.toLowerCase().split(/\s+/);
  const normalized = words.map(w => normalizeWord(w));
  return normalized.filter(word =>
    word.length > 2 && !STOPWORDS.has(word) && /^[a-z]+$/.test(word)
  );
}

// Count keyword overlap between two texts
function countKeywordOverlap(text1, text2) {
  const keywords1 = new Set(extractKeywords(text1));
  const keywords2 = new Set(extractKeywords(text2));
  
  let overlap = 0;
  for (const kw of keywords1) {
    if (keywords2.has(kw)) overlap++;
  }
  return overlap;
}

// Jaccard similarity for word overlap
function jaccardSimilarity(str1, str2) {
  const words1 = new Set(str1.toLowerCase().split(/\s+/));
  const words2 = new Set(str2.toLowerCase().split(/\s+/));
  
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
}

// Check if a lesson is duplicate using hybrid matching
function isDuplicate(newLesson, existingLessons, options = {}) {
  const threshold = options.jaccardThreshold || DEDUP_CONFIG.jaccardThreshold;
  const keywordMin = options.keywordOverlapMin || DEDUP_CONFIG.keywordOverlapMin;
  
  for (let i = 0; i < existingLessons.length; i++) {
    const existing = existingLessons[i];
    
    // Category must match - different categories are never duplicates
    if (existing.category !== newLesson.category) {
      continue;
    }
    
    const jaccard = jaccardSimilarity(newLesson.issue, existing.issue);
    const keywordOverlap = countKeywordOverlap(newLesson.issue, existing.issue);
    
    let isDup = false;
    let reason = '';
    
    if (jaccard >= threshold) {
      isDup = true;
      reason = `jaccard (${jaccard.toFixed(3)} >= ${threshold})`;
    } else if (keywordOverlap >= keywordMin) {
      isDup = true;
      reason = `keyword_overlap (${keywordOverlap} keywords)`;
    }
    
    if (isDup) {
      console.log(`[dedup] i=${i} category=${existing.category} jaccard=${jaccard.toFixed(3)} keywords=${keywordOverlap} → DUPLICATE (${reason})`);
      return { duplicate: true, matchIndex: i, similarity: jaccard, reason };
    } else {
      console.log(`[dedup] i=${i} category=${existing.category} jaccard=${jaccard.toFixed(3)} keywords=${keywordOverlap} → not duplicate`);
    }
  }
  
  return { duplicate: false, matchIndex: -1, similarity: 0, reason: 'no_match' };
}

// Add lesson with deduplication
function addLesson(newLesson, lessons) {
  const { duplicate, matchIndex, similarity, reason } = isDuplicate(newLesson, lessons);
  
  if (duplicate) {
    const updatedLessons = [...lessons];
    updatedLessons[matchIndex].count = (updatedLessons[matchIndex].count || 1) + 1;
    return { 
      lessons: updatedLessons, 
      action: 'skipped', 
      matchIndex,
      similarity,
      reason
    };
  }
  
  const newLessonWithCount = { ...newLesson, count: 1 };
  return { 
    lessons: [...lessons, newLessonWithCount], 
    action: 'added', 
    matchIndex: -1,
    similarity: 0,
    reason: 'new_lesson'
  };
}

// Load lessons from file
function loadLessons() {
  const fs = require('fs');
  const path = require('path');
  const filePath = path.join(__dirname, 'lessons.json');
  
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const data = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(data);
    return parsed.lessons || [];
  } catch (error) {
    console.error('Error loading lessons:', error.message);
    return [];
  }
}

// Save lessons to file
function saveLessons(lessons) {
  const fs = require('fs');
  const path = require('path');
  const filePath = path.join(__dirname, 'lessons.json');
  
  try {
    const data = JSON.stringify({ lessons }, null, 2);
    fs.writeFileSync(filePath, data);
    return true;
  } catch (error) {
    console.error('Error saving lessons:', error.message);
    return false;
  }
}

module.exports = { isDuplicate, addLesson, loadLessons, saveLessons, DEDUP_CONFIG };
