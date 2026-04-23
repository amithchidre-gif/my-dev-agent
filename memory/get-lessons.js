/**
 * Memory Loader - Loads lessons from JSON file
 * Simple and robust
 */

const fs = require('fs');
const path = require('path');

const LESSONS_FILE = path.join(__dirname, 'lessons.json');

/**
 * Get all lessons from the memory file
 * @returns {Array} Array of lesson objects (empty if file doesn't exist or is invalid)
 */
function getLessons() {
  try {
    if (!fs.existsSync(LESSONS_FILE)) {
      console.log('[MemoryLoader] lessons.json not found, returning empty array');
      return [];
    }
    
    const data = fs.readFileSync(LESSONS_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    
    if (!parsed.lessons || !Array.isArray(parsed.lessons)) {
      console.log('[MemoryLoader] Invalid format: missing "lessons" array');
      return [];
    }
    
    console.log(`[MemoryLoader] Successfully loaded ${parsed.lessons.length} lessons`);
    return parsed.lessons;
  } catch (error) {
    console.error('[MemoryLoader] Error loading lessons:', error.message);
    return [];
  }
}

module.exports = { getLessons };
