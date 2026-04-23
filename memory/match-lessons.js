/**
 * Lesson Matching Engine - Finds relevant lessons for a given task
 */

// Stopwords to ignore
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'without', 'by', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing',
  'fix', 'add', 'implement', 'create', 'update', 'change', 'remove', 'make'
]);

// Extract keywords from text
function extractKeywords(text) {
  const words = text.toLowerCase().split(/\s+/);
  return words.filter(word => 
    word.length > 2 && !STOPWORDS.has(word) && /^[a-z]+$/.test(word)
  );
}

// Calculate relevance score for a lesson against a task
function calculateScore(taskKeywords, lesson) {
  let score = 0;
  
  // Check issue field (highest weight)
  const issueKeywords = extractKeywords(lesson.issue || '');
  issueKeywords.forEach(kw => {
    if (taskKeywords.includes(kw)) score += 3;
  });
  
  // Check lesson field (medium weight)
  const lessonKeywords = extractKeywords(lesson.lesson || '');
  lessonKeywords.forEach(kw => {
    if (taskKeywords.includes(kw)) score += 2;
  });
  
  // Check fix field (lower weight)
  const fixKeywords = extractKeywords(lesson.fix || '');
  fixKeywords.forEach(kw => {
    if (taskKeywords.includes(kw)) score += 1;
  });
  
  // Category match bonus
  const categoryKeywords = extractKeywords(lesson.category || '');
  categoryKeywords.forEach(kw => {
    if (taskKeywords.includes(kw)) score += 2;
  });
  
  return score;
}

/**
 * Find relevant lessons for a given task
 * @param {string} task - Task description
 * @param {Array} lessons - Array of lesson objects
 * @returns {Array} Top 3 matching lessons (sorted by relevance)
 */
function findRelevantLessons(task, lessons) {
  if (!task || !lessons || lessons.length === 0) {
    return [];
  }
  
  const taskKeywords = extractKeywords(task);
  if (taskKeywords.length === 0) {
    return [];
  }
  
  // Score each lesson
  const scored = lessons.map(lesson => ({
    lesson: lesson,
    score: calculateScore(taskKeywords, lesson)
  }));
  
  // Filter lessons with score > 0 and sort by score
  const relevant = scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  
  console.log(`[Matcher] Task: "${task.substring(0, 50)}..."`);
  console.log(`[Matcher] Keywords: ${taskKeywords.join(', ')}`);
  console.log(`[Matcher] Found ${relevant.length} relevant lessons`);
  
  return relevant.map(item => ({
    ticket_id: item.lesson.ticket_id,
    category: item.lesson.category,
    issue: item.lesson.issue.substring(0, 100),
    lesson: item.lesson.lesson.substring(0, 150),
    score: item.score
  }));
}

module.exports = { findRelevantLessons, extractKeywords, calculateScore };
