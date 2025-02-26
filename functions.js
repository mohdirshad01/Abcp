const { db } = require(".");
const crypto = require('crypto');
const config = require('./config')

// In-memory caching with optional TTL
const localCache = new Map();
exports.cache = async (key, fetchFunction, ttl = 60000) => {
  const now = Date.now();
  const cached = localCache.get(key);
  if (cached && (!cached.expiry || cached.expiry > now)) {
    return cached.value;
  }
  localCache.delete(key);
  const data = await fetchFunction();
  localCache.set(key, { value: data, expiry: ttl > 0 ? now + ttl : null });
  return data;
};

exports.paginate = (arr) => {
  if (!Array.isArray(arr) || arr.length === 0) return [];
  const res = [];
  res.push([arr[0]]);
  for (let i = 1; i < arr.length; i += 2) {
    res.push(arr.slice(i, i + 2));
  }
  return res;
};


// Telegram Bot Admin Status Check
async function getAdminStatus(ctx, channelId, userId) {
  try {
    const member = await ctx.telegram.getChatMember(channelId, userId);
    return { isAdmin: ['administrator', 'creator'].includes(member.status), rights: member };
  } catch (error) {
    return { isAdmin: false, rights: null };
  }
}
exports.isBotAdminInChannel = async (ctx, channelId) => {
  const botInfo = await ctx.telegram.getMe();
  return getAdminStatus(ctx, channelId, botInfo.id);
};

exports.isUserAdminInChannel = (ctx, channelId, userId) => getAdminStatus(ctx, channelId, userId);

// Helper function to get the combined set of admin IDs
exports.getCombinedAdmins = async () => {
  try {
    const adminData = await db
      .collection('admin')
      .findOne({ admin: 1 }, { projection: { admins: 1 } });

    const dbAdmins = Array.isArray(adminData?.admins)
      ? adminData.admins
      : (typeof adminData?.admins === 'string' ? adminData.admins.split(',') : []);

    return new Set([...config.admins.map(String), ...dbAdmins.map(String)]);
  } catch (error) {
    console.error("Error in getCombinedAdmins:", error);
    return new Set();
  }
};

// Bonus levels fetch and calculation
exports.fetchBonusLevels = async () => {
  try {
    const adminData = await db.collection("admin").findOne({ admin: 1 });
    return adminData?.bonus_levels || [{ level: 0, required: 0, bonus: 0 }];
  } catch (error) {
    console.error("Error fetching referral levels: ", error);
    return [];
  }
};

exports.calculateBonusAmount = (referrals, currentLevel, levels) => {
  let newLevel = currentLevel, totalBonus = 0;
  levels.forEach(level => {
    if (referrals >= level.required && currentLevel < level.level) {
      newLevel = level.level;
      totalBonus += level.bonus;
    }
  });
  return { newLevel, totalBonus };
};

// ID encoding and decoding
exports.encodeId = (id) => Buffer.from(id.toString()).toString('base64').replace(/=+$/, '');
exports.decodeId = (encodedId) => Buffer.from(encodedId, 'base64').toString();

// Generate random values
exports.generate_random_code = (length) => {
  return Array.from({ length }, () => '0123456789ABCDEF'[Math.floor(Math.random() * 16)]).join('');
};

exports.getRandomNumber = (min, max) => {
  return Math.floor(Math.pow(Math.random(), 1.2) * (max - min + 1)) + min;
};

// Tax calculation
exports.calculateTax = (amount, taxRate) => Math.max(amount * (taxRate / 100));

// Secure hash generation
exports.generatehash = (input, salt = crypto.randomBytes(16).toString('hex')) => {
  const hash = crypto.createHash('sha256').update(`${input}:${salt}`).digest('hex');
  return `${salt}$${hash}`;
};

// Content cleaners
exports.cleanContent = (name) => {
  const cleanedName = name.replace(/[^\w\s]/g, "").trim();
  return cleanedName.length > 15 ? `${cleanedName.slice(0, 15)}...` : cleanedName;
};

exports.escapeHtml = (str = "") => {
  return str.replace(/[<>"'&]/g, (m) => {
    switch (m) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return m;
    }
  });
};

// URL Validation

exports.isValidUrl = (str) => {
  try {
    const url = new URL(str);
    // Ensure the URL is http or https
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
