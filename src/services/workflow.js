// Editorial workflow engine. Each transition lists who may perform it.
// Authors write and submit; editors and admins review, publish, schedule and archive.
const TRANSITIONS = {
  draft: { in_review: 'any', published: 'publish', scheduled: 'publish', archived: 'owner' },
  in_review: { draft: 'any', published: 'publish', scheduled: 'publish', archived: 'publish' },
  scheduled: { draft: 'publish', published: 'publish', archived: 'publish' },
  published: { draft: 'publish', archived: 'publish' },
  archived: { draft: 'owner', published: 'publish' },
};

function canTransition(user, post, to) {
  const from = post.status;
  if (from === to) return true;
  const rule = TRANSITIONS[from]?.[to];
  if (!rule) return false;
  const isOwner = String(post.author?._id || post.author) === String(user._id);
  if (rule === 'any') return isOwner || user.can('editAny');
  if (rule === 'owner') return isOwner || user.can('editAny');
  return user.can(rule);
}

function allowedTargets(user, post) {
  return Object.keys(TRANSITIONS[post.status] || {}).filter((to) => canTransition(user, post, to));
}

const LABELS = {
  draft: 'Draft',
  in_review: 'In review',
  scheduled: 'Scheduled',
  published: 'Published',
  archived: 'Archived',
};

module.exports = { TRANSITIONS, canTransition, allowedTargets, LABELS };
