const { db } = require(".");
const bot = require("./bot");
const { authAdmin } = require("./middlewares");
const { cleanContent } = require("./functions");

// Channel caching
let channelsCache = null;
let channelsCacheTimestamp = 0;
const CHANNEL_CACHE_TTL = 60_000; // 60 seconds TTL

// Concurrency and batch editing
const CONCURRENCY_LIMIT = 5;
const BATCH_DELAY = 1000; // Delay between batches (in ms)

// Bot Initialization & Caching
let cachedBotId = null;
let botInitAttempts = 0;
const MAX_INIT_ATTEMPTS = 3;


// Attempts to initialize bot info with a simple retry mechanism.
const RETRY_DELAY = 1000; // 1 second
async function initializeBot() {
  if (cachedBotId) return;
  while (botInitAttempts < MAX_INIT_ATTEMPTS) {
    try {
      botInitAttempts++;
      const botInfo = await bot.telegram.getMe();
      cachedBotId = botInfo.id;
      botInitAttempts = 0; // Reset attempts after success
      break; // Successfully cached bot ID
    } catch (error) {
      console.error("initializeBot attempt failed:", error);
      if (botInitAttempts >= MAX_INIT_ATTEMPTS) {
        console.error("Max bot init attempts reached.");
        break;
      }
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * botInitAttempts));
    }
  }
}

// Attempt initialization at startup
initializeBot().catch(console.error);


/**
 * Generate the inline keyboard for ban/unban actions.
 */
function generateActionKeyboard(userId) {
  return {
    inline_keyboard: [
      [{ text: "🛑 Ban ~ All Channels", callback_data: `/kick_all ${userId}` }],
      [
        { text: "🛑 Ban ~ Left Ones", callback_data: `/kick_left ${userId}` },
        { text: "🟢 UnBan", callback_data: `/unkick ${userId}` },
      ],
      [{ text: "↩️ Go Back", callback_data: `/get_user_settings ${userId}` }],
    ],
  };
}


/**
 * Build the final status message text from the statuses array.
 */
function buildStatusMessage(statuses) {
  return statuses
    .map(
      (item, idx) =>
        `#CH_${idx} ${item.name || `<code>Unknown_${idx}</code>`} ~ ${item.status || "Unknown"}`
    )
    .join("\n");
}


/**
 * Edits the inline message with the updated statuses.
 */
async function editStatusMessage(ctx, userId, statuses) {
  const finalText =
    `<b>ℹ️ User ${userId} Channel Status :-</b>\n\n` +
    buildStatusMessage(statuses) +
    `\n\n👇 Use buttons below to ban user from all channels or only from the left channels.`;
  try {
    await ctx.editMessageText(finalText, {
      parse_mode: "HTML",
      reply_markup: generateActionKeyboard(userId),
      disable_web_page_preview: true,
    });
  } catch (error) {
    // Ignore known benign errors
    if (
      !error.description?.includes("message is not modified") &&
      !error.description?.includes("message to edit not found")
    ) {
      console.error("editStatusMessage failed:", error);
    }
  }
}

/**
 * Processes items in batches with a concurrency limit and an optional afterBatch callback.
 *
 * @param {Array} items - Array of items to process.
 * @param {Function} processor - Async callback receiving (item, index).
 * @param {Function} [afterBatch] - Optional async callback called after each batch completes.
 */
async function processChannelsConcurrently(items, processor, afterBatch) {
  for (let i = 0; i < items.length; i += CONCURRENCY_LIMIT) {
    const batch = items.slice(i, i + CONCURRENCY_LIMIT);
    await Promise.all(batch.map((item, idx) => processor(item, i + idx)));
    if (afterBatch) {
      await afterBatch(i, i + batch.length);
    }
    if (i + CONCURRENCY_LIMIT < items.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY));
    }
  }
}

/**
 * Retrieves the array of channel objects from the database, with caching.
 */
async function getChannels() {
  const now = Date.now();
  if (channelsCache && now - channelsCacheTimestamp < CHANNEL_CACHE_TTL) {
    return channelsCache;
  }
  try {
    const dbResult = await db.collection("admin").findOne({ channels: 1 });
    channelsCache = (dbResult?.data || []).filter(ch => ch?.id);
    channelsCacheTimestamp = now;
  } catch (error) {
    console.error("Error fetching channels. Using stale cache if available.");
    return channelsCache || [];
  }
  return channelsCache;
}

/**
 * Checks if a specific user is an admin in a given channel.
 */
async function isAdminInChannel(channelId, userId) {
  try {
    const member = await bot.telegram.getChatMember(channelId, userId);
    return ["administrator", "creator"].includes(member.status);
  } catch (error) {
    console.error(`Admin check failed for user ${userId} in channel ${channelId} :`, error);
    return false;
  }
}

/**
 * Checks if the bot itself is an admin in a given channel.
 */
async function isBotAdminInChannel(channelId) {
  if (!cachedBotId) await initializeBot();
  if (!cachedBotId) {
    console.error("Bot ID not available; cannot check admin status.");
    return false;
  }
  try {
    const member = await bot.telegram.getChatMember(channelId, cachedBotId);
    return ["administrator", "creator"].includes(member.status);
  } catch (error) {
    console.error(`Bot admin check failed in channel ${channelId}:`, error);
    return false;
  }
}

/**
 * Handles status check action: gathers channel info and updates the message in batches.
 */
async function handleStatusCheck(ctx, userId) {
  const channels = await getChannels();
  if (!channels.length) {
    return ctx.answerCbQuery("⚠️ No channels configured.", { show_alert: true });
  }

  // Prepare statuses array (one per channel)
  const statuses = new Array(channels.length).fill(null).map(() => ({}));

  const processor = async (channel, idx) => {
    try {
      const [botIsAdmin, chat, member] = await Promise.all([
        isBotAdminInChannel(channel.id),
        bot.telegram.getChat(channel.id).catch(() => null),
        bot.telegram.getChatMember(channel.id, userId).catch(() => ({ status: "unknown" })),
      ]);
      const name = chat?.title ? cleanContent(chat.title) : `Channel ${channel.id}`;
      const inviteLink =
        chat?.invite_link || (chat?.username ? `https://t.me/${chat.username}` : null);
      statuses[idx].name = inviteLink ? `<a href="${inviteLink}">${name}</a>` : `<code>${channel.id}</code>`;
      statuses[idx].status = !botIsAdmin ? "Bot not admin" : member.status;
    } catch (error) {
      console.error(`Channel processing failed for ${channel.id}:`, error);
      statuses[idx].name = `<code>${channel.id}</code>`;
      statuses[idx].status = error.response?.error_code === 403 ? "No permissions" : "Check failed";
    }
  };

  const afterBatch = async () => {
    await editStatusMessage(ctx, userId, statuses);
  };

  await processChannelsConcurrently(channels, processor, afterBatch);
  await ctx.answerCbQuery("✅ Status check completed");
}

/**
 * Handles kick (ban) action, optionally filtering based on a provided filter function.
 *
 * If filterFn is provided, the kick only happens if filterFn(member) returns true.
 */
async function handleKickAction(ctx, filterFn) {
  const userId = parseInt(ctx.match[1], 10);
  if (isNaN(userId)) {
    console.error("handleKickAction: Invalid user ID");
    return ctx.answerCbQuery("⚠️ Operation failed (invalid user ID)", { show_alert: true });
  }

  const channels = await getChannels();
  const statuses = new Array(channels.length).fill(null).map(() => ({}));

  const processor = async (channel, idx) => {
    statuses[idx].name = `<code>${channel.id}</code>`; // Default channel name display
    try {
      const [botIsAdmin, userIsAdmin] = await Promise.all([
        isBotAdminInChannel(channel.id),
        isAdminInChannel(channel.id, userId),
      ]);

      if (!botIsAdmin) {
        statuses[idx].status = "Bot not admin";
        return;
      }
      if (userIsAdmin) {
        statuses[idx].status = "User is admin";
        return;
      }
      if (filterFn) {
        const member = await bot.telegram.getChatMember(channel.id, userId).catch(() => null);
        if (!member || !filterFn(member)) {
          statuses[idx].status = "Skipped ban";
          return;
        }
      }
      // Ban the user (with revoke_messages option if supported)
      await bot.telegram.banChatMember(channel.id, userId, { revoke_messages: true });
      statuses[idx].status = "Banned";
    } catch (error) {
      console.error(`Kick failed in ${channel.id}:`, error);
      statuses[idx].status = error.response?.error_code === 403 ? "No permissions" : "Failed";
    }
  };

  const afterBatch = async () => {
    await editStatusMessage(ctx, userId, statuses);
  };

  await processChannelsConcurrently(channels, processor, afterBatch);
  await ctx.answerCbQuery("✅ Operation completed");
}

/**
 * Action for checking channel status of a user.
 */
bot.action(/^\/check_status (\d+)$/, authAdmin, async (ctx) => {
  try {
    const userId = parseInt(ctx.match[1], 10);
    if (isNaN(userId)) throw new Error("Invalid user ID");
    await handleStatusCheck(ctx, userId);
  } catch (error) {
    console.error("Status check failed:", error);
    await ctx.answerCbQuery("⚠️ Operation failed !");
  }
});

/**
 * Action for kicking (banning) a user across all channels.
 */
bot.action(/^\/kick_all (\d+)$/, authAdmin, (ctx) => {
  handleKickAction(ctx);
});

/**
 * Action for kicking (banning) a user only if they are already "left", "kicked", or "banned".
 */
bot.action(/^\/kick_left (\d+)$/, authAdmin, (ctx) => {
  handleKickAction(ctx, (member) => ["left", "kicked", "banned"].includes(member.status));
});

/**
 * Action for unbanning (unkicking) a user.
 */
bot.action(/^\/unkick (\d+)$/, authAdmin, async (ctx) => {
  try {
    const userId = parseInt(ctx.match[1], 10);
    if (isNaN(userId)) throw new Error("Invalid user ID");

    const channels = await getChannels();
    const statuses = new Array(channels.length).fill(null).map(() => ({}));

    const processor = async (channel, idx) => {
      statuses[idx].name = `<code>${channel.id}</code>`;
      try {
        const botIsAdmin = await isBotAdminInChannel(channel.id);
        if (!botIsAdmin) {
          statuses[idx].status = "Bot not admin";
          return;
        }
        const member = await bot.telegram.getChatMember(channel.id, userId).catch(() => null);
        if (!member) {
          statuses[idx].status = "User not found";
          return;
        }
        if (member.status === "kicked") {  // Only unban if the user is actually banned ("kicked")
          await bot.telegram.unbanChatMember(channel.id, userId);
          statuses[idx].status = "Unbanned";
        } else {
          statuses[idx].status = "Not banned";
        }
      } catch (error) {
        console.error(`Unban failed in ${channel.id}:`, error);
        statuses[idx].status = "Failed";
      }
    };

    const afterBatch = async () => {
      await editStatusMessage(ctx, userId, statuses);
    };

    await processChannelsConcurrently(channels, processor, afterBatch);
    await ctx.answerCbQuery("✅ User unbanned");
  } catch (error) {
    console.error("Unkick failed:", error);
    await ctx.answerCbQuery("⚠️ Unban operation failed");
  }
});


bot.on('chat_member', async (ctx, next) => {
  try {
    const chatMemberData = ctx.update?.chat_member;
    if (!chatMemberData) return next();

    const { new_chat_member: { user, status } = {} } = chatMemberData;
    if (!user) return next();

    const userID = Number(user.id);
    const channelID = String(ctx.chat.id);

    const adminDoc = await db.collection("admin").findOne(
      { channels: 1 },
      { projection: { data: 1, _id: 0 } }
    );
    const channelsArray = adminDoc?.data?.map(ch => ch.id) || [];
    if (!channelsArray.includes(channelID)) {
      console.log("Channel not tracked:", channelID);
      return next();
    }

    const userDoc = await db.collection('users').findOne({ user_id: userID });
    if (!userDoc) return next();

    const chanInfo = userDoc?.channel_data?.[channelID] || {
      hasEverJoined: false,
      hasEverLeft: false
    };

    if (status === 'member' && !chanInfo.hasEverJoined) {
      await db.collection("admin").updateOne(
        { channels: 1 },
        { $inc: { ["data.$[elem].joined"]: 1 } },
        { arrayFilters: [{ "elem.id": channelID }] }
      );
      await db.collection('users').updateOne(
        { user_id: userID },
        {
          $set: {
            [`channel_data.${channelID}.hasEverJoined`]: true,
            [`channel_data.${channelID}.currentlyJoined`]: true
          }
        },
        { upsert: true }
      );
    } else if (status === 'left' && !chanInfo.hasEverLeft) {
      await db.collection("admin").updateOne(
        { channels: 1 },
        { $inc: { ["data.$[elem].left"]: 1 } },
        { arrayFilters: [{ "elem.id": channelID }] }
      );
      await db.collection('users').updateOne(
        { user_id: userID },
        {
          $set: {
            [`channel_data.${channelID}.hasEverLeft`]: true,
            [`channel_data.${channelID}.currentlyJoined`]: false
          }
        },
        { upsert: true }
      );
    }

    next();
  } catch (err) {
    console.error("Error handling 'chat_member':", err);
    next();
  }
});

