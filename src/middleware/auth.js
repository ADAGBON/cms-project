const User = require('../models/User');

async function loadUser(req, res, next) {
  res.locals.currentUser = null;
  if (!req.session?.userId) return next();
  try {
    const user = await User.findById(req.session.userId);
    if (user && user.active) {
      req.user = user;
      res.locals.currentUser = user;
    } else {
      delete req.session.userId;
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

function requireLogin(req, res, next) {
  if (req.user) return next();
  req.session.returnTo = req.originalUrl;
  return res.redirect('/admin/login');
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (req.user?.can(permission)) return next();
    res.status(403);
    return res.render('admin/error', { title: 'Not allowed', message: 'Your role does not have access to this page.' });
  };
}

module.exports = { loadUser, requireLogin, requirePermission };
