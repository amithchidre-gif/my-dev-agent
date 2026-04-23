const fs = require('fs');
const path = require('path');

const MEMORY_FILE = path.join(__dirname, 'lessons.json');

// Load lessons from file
function loadLessons() {
  try {
    if (!fs.existsSync(MEMORY_FILE)) {
      // Create default structure if file doesn't exist
      const defaultLessons = { lessons: [] };
      fs.writeFileSync(MEMORY_FILE, JSON.stringify(defaultLessons, null, 2));
      return defaultLessons.lessons;
    }
    
    const data = fs.readFileSync(MEMORY_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    return parsed.lessons || [];
  } catch (error) {
    console.error('Error loading lessons:', error.message);
    return [];
  }
}

// Save lessons to file
function saveLessons(lessons) {
  try {
    const data = JSON.stringify({ lessons }, null, 2);
    fs.writeFileSync(MEMORY_FILE, data);
    return true;
  } catch (error) {
    console.error('Error saving lessons:', error.message);
    return false;
  }
}

// Add a new lesson
function addLesson(lesson) {
  const lessons = loadLessons();
  lessons.push({
    ticket_id: lesson.ticket_id,
    issue: lesson.issue,
    fix: lesson.fix,
    lesson: lesson.lesson,
    category: lesson.category,
    timestamp: new Date().toISOString()
  });
  saveLessons(lessons);
  return lessons;
}

// Get lessons by category
function getLessonsByCategory(category) {
  const lessons = loadLessons();
  return lessons.filter(l => l.category === category);
}

// Get lessons by ticket
function getLessonsByTicket(ticketId) {
  const lessons = loadLessons();
  return lessons.filter(l => l.ticket_id === ticketId);
}

module.exports = {
  loadLessons,
  saveLessons,
  addLesson,
  getLessonsByCategory,
  getLessonsByTicket
};
