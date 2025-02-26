const { Telegraf } = require("telegraf");
const rateLimit = require("telegraf-ratelimit");
const config = require("./config.js");

// Initialize bot
const bot = new Telegraf(config.bot_token);
module.exports = bot;

// Rate limiting middleware
bot.use((ctx, next) => {
  if (ctx.chat?.type === "private") {
    return rateLimit({
      window: 1 * 1000, // Gap between updates
      limit: 1, // Updates allowed in that gap
      onLimitExceeded: (ctx) => {
        console.warn(`Rate limit exceeded for user: ${ctx.from?.id}`);
        ctx.replyWithHTML("<b>⚠️ Too many requests, please slow down.</b>");
      },
    })(ctx, next);
  } else {
    return next();
  }
});

// Middleware to measure response time and log additional metrics
bot.use(async (ctx, next) => {
  const start = Date.now();
  try {
    await next();
  } catch (err) {
    console.error("Error during middleware execution:", err);
  } finally {
    const responseTime = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${ctx.updateType} handled in ${responseTime}ms`);
  }
});

// Custom middlewares and handlers
const { botStatus } = require("./middlewares.js");
bot.use(botStatus);

// Import handlers and other modules
require("./handlers.js");
require("./broadcast.js");
require("./kicker.js")

// Global error handling
bot.catch((err) => {
  console.error("Global error caught:", err);
});

// Launch the bot and log bot username
const allowedUpdates = ["message", "callback_query", "chat_member", "contact"];
bot.launch({ allowedUpdates })
bot.telegram.getMe().then((res) => {
  console.log(`@${res.username} (${res.id}) is now running`)
}).catch((err) => console.error("Failed to get bot info:", err));





