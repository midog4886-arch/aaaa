// A per-page store for visitors. It never calls the member API or uploads video.
// Closing the page discards the draft; the coach can export a readable report.
export const createGuestPerformanceReviews = () => {
  let reviews = [];
  const response = data => Promise.resolve({ data });
  return {
    list: () => response([...reviews]),
    createLocal: (_guestId, input) => {
      const review = {
        id: `guest-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        title: input.title, sport: input.sport, skill: input.skill,
        video_mode: 'local', status: 'draft', created_at: new Date().toISOString(),
        coach_summary: '', parent_summary: '', markers: [], samples: [], comparison: null,
      };
      reviews = [review, ...reviews];
      return response(review);
    },
    update: (id, changes) => {
      const current = reviews.find(row => row.id === id);
      if (!current) return Promise.reject(new Error('Guest review not found'));
      const updated = { ...current, ...changes, id, video_mode: 'local', status: 'draft' };
      reviews = reviews.map(row => row.id === id ? updated : row);
      return response(updated);
    },
    delete: id => {
      reviews = reviews.filter(row => row.id !== id);
      return response(null);
    },
  };
};
