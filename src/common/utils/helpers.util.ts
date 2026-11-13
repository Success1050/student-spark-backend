/**
 * Ported from studentspark_backend/utils/helpers.js
 */
export const getRandomColor = (): string => {
  const letters = '0123456789ABCDEF';
  let color = '#';
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
};

/**
 * Ported from studentspark_backend/AIRoutes/studyPlanRoute.js
 * Returns current Date adjusted to Africa/Lagos (WAT, UTC+1)
 */
export const getWatNow = (): Date => {
  const now = new Date();
  return new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
};
