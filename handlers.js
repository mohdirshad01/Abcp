const bot = require("./bot");
const { db } = require(".");
const { Scenes, session } = require('telegraf');
const { get_admin, get_user_settings_tab, get_main_menu, get_channel_settings, get_social_sites, get_admin_settings, get_top_stats, get_task_settings } = require("./layout");
const { check_status, authAdmin, refer_system, check_user, check_join } = require("./middlewares");
const { generate_random_code, paginate } = require("./functions");
const { create_response, cancel_button, back_button } = require("./response_handlers");
const { ObjectId } = require('mongodb');
const axios = require('axios');

bot.use(session());

const ERROR_MESSAGE = "⚠️ An error occured. Contact Support (/help).";

// ======== Hears Command : /start ========
bot.start(check_user, check_join, async (ctx, next) => {
  try {
    const { id: userId, firstName = 'none', username = 'none' } = ctx.from;
    const userCollection = db.collection("users");
    const adminCollection = db.collection("admin");

    // Update or insert user information
    const userUpdateResult = await userCollection.findOneAndUpdate(
      { user_id: userId },
      { $set: { firstName, userName: username } },
      { upsert: true, returnDocument: 'before' }
    );

    if (!userUpdateResult) {
      await adminCollection.updateOne(
        { admin: 1 },
        { $inc: { total_users: 1 } },
        { upsert: true }
      );
    }

    await sendBalanceMessage(ctx);
  } catch (err) {
    console.error(`Error in /start command for user (${ctx.from.id}) :`, err);
    await ctx.reply(ERROR_MESSAGE);
  }
});


// ======== Inline Command : check_join (to check join status) ========
const userCooldowns = new Map();
const COOLDOWN_PERIOD = 2000; // 2 seconds cooldown

bot.action('check_join', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const now = Date.now();

    // Enforce cooldown period
    if (userCooldowns.has(userId) && now - userCooldowns.get(userId) < COOLDOWN_PERIOD) {
      return ctx.answerCbQuery('⚠️ Please wait...', true);
    }

    const adminData = await db.collection('admin').findOne({ channels: 1 });
    const channels = adminData?.data || [];

    if (!Array.isArray(channels) || channels.length === 0) {
      await refer_system(ctx);
      return ctx.answerCbQuery('⚠️ No channels found!', true);
    }

    // Set cooldown and schedule its removal
    userCooldowns.set(userId, now);
    setTimeout(() => userCooldowns.delete(userId), COOLDOWN_PERIOD);

    const notJoinedChannels = [];

    // Check user's subscription status for required channels
    for (const channel of channels) {
      try {
        const status = (await ctx.telegram.getChatMember(channel.id, userId)).status;
        if (['left', 'kicked'].includes(status)) {
          notJoinedChannels.push(channel.id);
        }
      } catch (error) {
        console.error(`Error checking ${channel.id}:`, error);
        notJoinedChannels.push(channel.id);
      }
    }

    if (notJoinedChannels.length > 0) {
      // Fetch invite links for unsubscribed channels
      const inviteLinks = await Promise.all(
        notJoinedChannels.map(async (channelId) => {
          try {
            const chat = await ctx.telegram.getChat(channelId);
            return chat.invite_link ? { id: channelId, link: chat.invite_link } : null;
          } catch (error) {
            console.error(`Error getting invite link for ${channelId}:`, error);
            return null;
          }
        })
      );

      const validLinks = inviteLinks.filter(Boolean);
      let buttons = validLinks.map(({ link }) => ({ text: 'Join', url: link }));
      buttons = paginate(buttons, 2);

      buttons.push([{ text: '↪️ Continue Again', callback_data: 'check_join' }]);

      const text = `<b>⚠️ You Need To Join All The Channel's !\n\n👇🏻 Please Click On The Buttons Below And Join Them To Claim BIG PromoCode's !! 🤑❤️</b>`;

      try {
        // Check if the message has a photo (with caption) or is a text message
        if (ctx.update.callback_query.message.photo) {
          await ctx.editMessageCaption(text, {
            reply_markup: { inline_keyboard: buttons },
            parse_mode: 'HTML',
          });
        } else {
          await ctx.editMessageText(text, {
            reply_markup: { inline_keyboard: buttons },
            parse_mode: 'HTML',
          });
        }
      } catch (error) {
        if (
          error.response?.error_code === 400 &&
          error.response?.description.includes("message is not modified")
        ) {
          console.warn("Ignoring 'message is not modified' error.");
        } else {
          throw error;
        }
      }

      return ctx.answerCbQuery('⚠️ You have not joined all the channels.', { show_alert: true });
    }

    // If user has joined all channels, proceed
    await ctx.answerCbQuery('✅ Welcome to bot.');
    await ctx.deleteMessage();
    await sendBalanceMessage(ctx);
  } catch (error) {
    console.error('Error in check_join:', error);
    ctx.answerCbQuery('⚠️ An error occurred. Contact Support (/help)');
  }
});




// <!---- Command Handler Function : App List ---- !> //
async function sendBalanceMessage(ctx, isCallback = false) {
  const MAX_BUTTONS_PER_ROW = 2;
  try {
    const tasks = await db.collection('tasks')
      .find()
      .toArray();

    if (!tasks.length) {
      if (ctx.update.callback_query) {
        await ctx.answerCbQuery("⚠️ No Yono Apps available now.", { show_alert: true });
      } else {
        await ctx.reply("⚠️ No Yono Apps available now.");
      }
      return;
    }

    const keyboard = [];
    for (let i = 0; i < tasks.length; i += MAX_BUTTONS_PER_ROW) {
      const row = tasks
        .slice(i, i + MAX_BUTTONS_PER_ROW)
        .map(task => ({
          text: task.name,
          callback_data: `task_${task._id}`
        }));
      keyboard.push(row);
    }

    const mediaData = {
      type: 'photo',
      media: 'https://t.me/AllYonoBonus/46',
      caption: "<b>🛑 Choose Yono App To Claim BIG PromoCode's👇</b>\n\n" +
        "<b>🎁 Claim BIG PromoCodes & Get Upto ₹1-₹999 Random Amount !!💰</b>\n\n" +
        "<b>📌 Must Active in All Channel's To Get Daily BIG Yono PromoCode's 👇</b>",
      parse_mode: 'HTML'
    };

    if (isCallback) {
      await ctx.editMessageMedia(mediaData, { reply_markup: { inline_keyboard: keyboard } });
    } else {
      await ctx.replyWithPhoto(mediaData.media, {
        caption: mediaData.caption,
        parse_mode: mediaData.parse_mode,
        reply_markup: { inline_keyboard: keyboard }
      });
    }

  } catch (err) {
    console.error('Error in sendBalanceMessage function:', err);
    await ctx.replyWithHTML("⚠️ An error occurred. Please try again later.");
  }
}

bot.action("Account", check_user, check_join, async (ctx) => {
  await sendBalanceMessage(ctx, true);
});


// ======== Hears Command : /help ========
bot.help(check_user, async (ctx) => {
  try {
    const adminData = await db.collection("admin").findOne({ admin: 1 });

    if (!adminData) {
      return await ctx.reply(ERROR_MESSAGE);
    }

    const isHelpForumEnabled = adminData?.admin_forum;

    if (isHelpForumEnabled) {
      await ctx.replyWithHTML(
        `<i>You are now in direct contact with admins.\n\nSend your query, and we will try to reply back soon with the answer.</i>`,
        {
          reply_markup: {
            resize_keyboard: true,
            keyboard: [[{ text: cancel_button }]]
          }
        }
      );
      create_response(ctx, 'support');
    } else {
      const helpUserLink = 'https://www.botsbazaar.org/upibots/bugreport';
      if (!helpUserLink || typeof helpUserLink !== "string" || !helpUserLink.startsWith("http")) {
        return await ctx.reply("⚠️ Invalid report link. Please contact support.");
      }

      await ctx.replyWithHTML(
        `Hi User,\n\nWe sincerely appreciate your help in identifying bugs and errors. Kindly use the button below to report any issues by filling out the form.\n\n🙌🏻 Thank you for your support.`,
        {
          reply_markup: {
            inline_keyboard: [[{ text: "🔧 Report Bugs", url: helpUserLink }]]
          }
        }
      );
    }
  } catch (error) {
    console.error("Error in help command :", error);
    await ctx.reply(ERROR_MESSAGE);
  }
});


// ======== Inline action : /help ========
bot.action('/help', check_user, async (ctx) => {
  await ctx.replyWithHTML(
    `<i>You are now in direct contact with admins.\n\nSend your query, and we will try to reply back soon with the answer.</i>`,
    {
      reply_markup: {
        resize_keyboard: true,
        keyboard: [[{ text: cancel_button }]]
      }
    }
  );
  create_response(ctx, 'support');
});


// <!---- Command Handler : /info ---- !> //
const formatUptime = (seconds) => {
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${d}d ${h}h ${m}m ${s}s`;
};

bot.hears("/info", async (ctx) => {
  try {
    const startTime = Date.now();
    await ctx.telegram.getMe();
    const responseTime = Date.now() - startTime;

    const uptime = process.uptime();
    const currentYear = new Date().getFullYear();

    let infoMessage = `👋🏻 <b>Hello, User !</b>\n\n` +
      `<b>Bot Version :</b> ${process.env.BOT_VERSION || 'v1.4.3'}\n` + // Use env variable
      `<b>Last Update :</b> ${process.env.BOT_LAST_UPDATE || 'February 2025'}\n` +
      `<b>Current Response Time :</b> ${responseTime} ms\n` + // Fixed label
      `<b>Bot Uptime :</b> ${formatUptime(uptime)}\n` +
      `<b>Stack :</b> Node.js (${process.version}) + Telegraf (v${require('./package.json').version})\n` +
      `<b>Database :</b> MongoDB (v6.11.0)\n\n` + // Consider dynamic fetch if possible
      `©️ <a href="https://t.me/BoTsBazaAr">BoTsBazaAr 2024-${currentYear}</a>`; // Dynamic year

    const replyMarkup = {
      inline_keyboard: [
        [{ text: "Dev 🇮🇳", url: "https://t.me/ArmyHeroes" }]
      ],
    };

    await ctx.replyWithHTML(infoMessage, { reply_markup: replyMarkup });
  } catch (error) {
    console.error("Failed to fetch data in /info command:", error); // Use a logger
    await ctx.reply(ERROR_MESSAGE ?? "❌ An error occurred."); // Fallback message
  }
});


// <!---- Command Handler : /ping ---- !> //
bot.hears(["/ping", "ping", ".ping"], async (ctx) => {
  const startTime = Date.now();
  await ctx.telegram.getMe();
  const responseTime = Date.now() - startTime;

  let text = `Average Ping : ${responseTime} ms`;

  await ctx.replyWithHTML(text);
});



// <!.......Admin Handlers Starts Here.........!>

bot.command(["settings"], authAdmin, async (ctx) => {
  let adminMarkup = await get_admin(ctx);
  ctx.replyWithHTML(adminMarkup.text, adminMarkup.markup);
});

// --- Admin panel layout handler and functions ---//
const handleAdminAction = async (ctx, getSettingsFunction, actionName) => {
  try {
    let adminMarkup = await getSettingsFunction(ctx);
    await ctx.editMessageText(adminMarkup.text, adminMarkup.markup);
  } catch (error) {
    console.error(`Error in ${actionName} action :`, error);
    await ctx.answerCbQuery(ERROR_MESSAGE, { show_alert: true });
  }
};

bot.action("/admin", authAdmin, async (ctx) => handleAdminAction(ctx, get_admin, "/admin"));
bot.action("/admin_settings", authAdmin, async (ctx) => handleAdminAction(ctx, get_admin_settings, "/admin_settings"));
bot.action("/channel_set", authAdmin, async (ctx) => handleAdminAction(ctx, get_channel_settings, "/channel_set"));
bot.action("/top_stats", authAdmin, async (ctx) => handleAdminAction(ctx, get_top_stats, "/top_stats"));
bot.action("/task_settings", authAdmin, async (ctx) => handleAdminAction(ctx, get_task_settings, "/task_settings"));


// --- Admin panel response handler and functions ---//
bot.action("/user_settings", authAdmin, async (ctx) => {
  await ctx.deleteMessage().catch((err) => console.log(err));
  await ctx.replyWithHTML(`Send user's telegram Chat Id :-`, {
    reply_markup: {
      keyboard: [
        [
          { text: back_button }
        ],
      ],
      resize_keyboard: true,
    },
  });
  create_response(ctx, "admin_user_id", {}, "admin_panel");
});

bot.action(/^\/change_balance (.+)$/, authAdmin, async (ctx) => {
  let user_id = ctx.match[1];
  await ctx.deleteMessage().catch((err) => console.log(err));
  await ctx.replyWithHTML(
    `Send the amount to change in user's balance :-\n\nE.g, send 15 to add or -15 to decrease the balance.`,
    {
      reply_markup: {
        keyboard: [[{ text: back_button }]],
        resize_keyboard: true,
      },
    }
  );
  create_response(ctx, "admin_balance_amount", { user_id: parseInt(user_id) }, "user_settings");
});

bot.action(/^\/get_user_settings (.+)$/, authAdmin, async (ctx, next) => {
  let user_id = ctx.match[1]
  if (!user_id) return next()

  const userData = await db.collection('users').findOne({ user_id: parseInt(user_id) });
  if (!userData) return await ctx.replyWithHTML('⚠️ User not found in bot database.');

  const userMarkup = await get_user_settings_tab(ctx, null, userData);
  await ctx.editMessageText(userMarkup.text, userMarkup.keyboard);
});



// ======== Send Message To User ========
bot.action(/^\/reply (.+)$/, authAdmin, async (ctx) => {
  try {
    const user_id = ctx.match[1];

    if (!user_id || typeof user_id !== 'string') {
      await ctx.replyWithHTML('⚠️ User not found in the database.');
      return;
    }

    await ctx.deleteMessage();

    create_response(ctx, 'reply_to_query', { user_id });

    await ctx.replyWithHTML(
      `Enter the message to send to user :-`,
      {
        reply_markup: {
          resize_keyboard: true,
          keyboard: [[{ text: back_button || 'Back' }]],
        },
      }
    );
  } catch (err) {
    console.error('Error in /reply action:', err);
    await ctx.replyWithHTML('An error occurred. Please try again.');
  }
});

const handleAdminResponse = async (ctx, message, callbackData) => {
  try {
    await ctx.deleteMessage().catch((err) => console.log(err));
    await ctx.replyWithHTML(message, {
      reply_markup: {
        keyboard: [
          [
            { text: back_button }
          ]
        ],
        resize_keyboard: true,
      },
    });
    create_response(ctx, callbackData);
  } catch (error) {
    console.error(`Error in ${callbackData} action :`, error);
  }
};

bot.action("/add_admin", authAdmin, async (ctx) => {
  await handleAdminResponse(ctx, "Send user's chat Id to Promote as Admin :-", "add_admin_id");
});


// ---- Admin Panel Inline Status Change Function & Handlers ---//
bot.action(/^\/change_ban (.+)$/, authAdmin, async (ctx) => {
  let user_id = ctx.match[1];
  let userData = await db.collection("users").findOne({ user_id: parseInt(user_id) }, { projection: { _id: 1, banned: 1, user_id: true } });

  if (!userData) return;

  if (userData.banned) {
    await db.collection("users").updateOne({ _id: userData._id }, { $unset: { banned: 1 } });

  } else {

    await db.collection("users").updateOne({ _id: userData._id }, { $set: { banned: true } });
  }

  let newUserData = await get_user_settings_tab(ctx, userData.user_id);
  await ctx.answerCbQuery('✅ action completed.')
  await ctx.editMessageText(newUserData.text, newUserData.keyboard);
});

bot.action("/change_bot_status", authAdmin, async (ctx) => {
  let adminData = (await db.collection("admin").findOne({ admin: 1 }, { projection: { _id: 0, bot_off: 1 } })) || {};

  if (adminData?.bot_off) {
    global.bot_status = "on";
    await db.collection("admin").updateOne({ admin: 1 }, { $unset: { bot_off: 1 } });
    await ctx.answerCbQuery(`✅ Bot Has Been Enabled.`, { show_alert: false });

  } else {
    global.bot_status = "off";
    await db.collection("admin").updateOne({ admin: 1 }, { $set: { bot_off: true } }, { upsert: true });
    await ctx.answerCbQuery(`⚠️ Bot Has Been Disabled.`, { show_alert: false });
  }
  let newAdminMarkup = await get_admin(ctx);
  await ctx.editMessageText(newAdminMarkup.text, newAdminMarkup.markup)
    .catch((err) => console.error("Error in /change_bot_status action : ", err));
});


// ======== Remove Admin ========
bot.action(/remove_admin_(.+)/, async (ctx) => {
  try {
    const AdminId = ctx.match[1];

    if (!AdminId) {
      await ctx.answerCbQuery(`⚠️ Admin Not Found !`, { show_alert: true });
      return;
    }

    const adminData = await db.collection('admin').findOne({ admin: 1 });
    const Admin = adminData?.admins || [];
    if (!Admin.includes(AdminId)) {
      await ctx.answerCbQuery(`⚠️ Admin Not Found !`, { show_alert: true });
      return;
    }

    await db.collection('admin').updateOne({ admin: 1 }, { $pull: { admins: AdminId } });
    await ctx.answerCbQuery("✅ Admin successfully removed.", { show_alert: true });

    await handleAdminAction(ctx, get_admin_settings, "/admin_settings");
  } catch (error) {
    console.error(error);
    await ctx.answerCbQuery(ERROR_MESSAGE, { show_alert: true });
  }
});



//---- Channel Settings Handlers ----//
bot.action("/channels_settings", authAdmin, async (ctx) => {
  try {
    const channels_data = (await db.collection("admin").findOne({ channels: 1 })) || {};
    const channels = channels_data?.data || [];

    const channelsWithDetails = await Promise.all(
      channels.map(async (channel) => {
        try {
          const inviteLink = await ctx.telegram.exportChatInviteLink(channel.id);
          const chatInfo = await ctx.telegram.getChat(channel.id);
          return { id: channel.id, inviteLink, name: chatInfo.title || channel.id };
        } catch {
          return {
            id: channel.id,
            inviteLink: "⚠️ Error fetching invite link !",
            name: "⚠️ Error fetching channel name !",
          };
        }
      })
    );

    // Function to generate a short button name
    const buttonName = (name) => name.replace(/[^\w\s]/g, "").trim().slice(0, 3) + "..";

    const buttons = channelsWithDetails.map((channel, index) => [
      { text: buttonName(channel.name), callback_data: `/check_if_admin ${channel.id}` },
      index > 0
        ? { text: "⬆️", callback_data: `/move_channel ${channel.id} up` }
        : { text: "⬆️", callback_data: "noop" },
      index < channelsWithDetails.length - 1
        ? { text: "⬇️", callback_data: `/move_channel ${channel.id} down` }
        : { text: "⬇️", callback_data: "noop" },
      { text: "❌", callback_data: `/delete_channel ${channel.id}` },
    ]);

    const cleanContent = (name) => {
      const cleanedName = name.replace(/[^\w\s]/g, "").trim();
      return cleanedName.length > 15 ? `${cleanedName.slice(0, 15)}...` : cleanedName;
    };

    buttons.push([{ text: "➕ Add Channel", callback_data: "/add_channels" }]);
    buttons.push([{ text: "Go Back", callback_data: "/admin" }]);

    const channelsText = channelsWithDetails.length
      ? channelsWithDetails
        .map((channel, index) => {
          const safeName = cleanContent(channel.name);
          return `${index + 1}. <code>${channel.id}</code> ~ <a href="${channel.inviteLink}">${safeName}</a>`;
        })
        .join("\n")
      : "No channels added yet";


    await ctx.editMessageText(
      `<b>⚙️ Hello, Welcome To The Channel Settings.</b>\n\n<b>🏷 Total Channels In Check</b> : ${channels.length}\n\n${channelsText}\n\nℹ️ <a href="t.me/BotsBazaar">This Bot Is Powered By BotsBazaar</a>`,
      {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: buttons },
        disable_web_page_preview: true,
      }
    );
  } catch {
    await ctx.answerCbQuery("⚠️ Unable to fetch channel settings !", { show_alert: true });
  }
});


// ======= Move Channel Up/Down =======
bot.action(/\/move_channel (\S+) (up|down)/, authAdmin, async (ctx) => {
  try {
    const [, channelId, direction] = ctx.match;
    const channels_data = (await db.collection("admin").findOne({ channels: 1 })) || {};
    const channels = channels_data?.data || [];
    const index = channels.findIndex((channel) => channel.id === channelId);

    if (index === -1) {
      await ctx.answerCbQuery("⚠️ Channel not found !", { show_alert: true });
      return;
    }

    // Swap positions based on direction
    if (direction === "up" && index > 0) {
      [channels[index - 1], channels[index]] = [channels[index], channels[index - 1]];
    } else if (direction === "down" && index < channels.length - 1) {
      [channels[index], channels[index + 1]] = [channels[index + 1], channels[index]];
    } else {
      return ctx.answerCbQuery("⚠️ Cannot move channel further!", { show_alert: true });
    }

    await db.collection("admin").updateOne(
      { channels: 1 },
      { $set: { data: channels } },
      { upsert: true }
    );

    // Retrieve channel details including invite link and name
    const updatedChannels = await Promise.all(
      channels.map(async (channel) => {
        try {
          const inviteLink = await ctx.telegram.exportChatInviteLink(channel.id);
          const chatInfo = await ctx.telegram.getChat(channel.id);
          return { id: channel.id, inviteLink, name: chatInfo.title || channel.id };
        } catch {
          return { id: channel.id, inviteLink: "⚠️ Error fetching invite link !", name: "⚠️ Error fetching channel name !" };
        }
      })
    );

    // Function to generate a short button name
    const buttonName = (name) => name.replace(/[^\w\s]/g, "").trim().slice(0, 3) + "..";

    const buttons = updatedChannels.map((channel, idx) => [
      { text: buttonName(channel.name), callback_data: `/check_if_admin ${channel.id}` },
      idx > 0
        ? { text: "⬆️", callback_data: `/move_channel ${channel.id} up` }
        : { text: "⬆️", callback_data: "noop" },
      idx < updatedChannels.length - 1
        ? { text: "⬇️", callback_data: `/move_channel ${channel.id} down` }
        : { text: "⬆️", callback_data: "noop" },
      { text: "❌", callback_data: `/delete_channel ${channel.id}` },
    ]);

    buttons.push([{ text: "➕ Add Channel", callback_data: "/add_channels" }]);
    buttons.push([{ text: "Go Back", callback_data: "/admin" }]);

    // Generate formatted text for displaying channel
    const channelsText = updatedChannels.length
      ? updatedChannels.map((channel, index) => `${index + 1}. <code>${channel.id}</code> ~ <a href="${channel.inviteLink}">${channel.name}</a>`).join("\n")
      : "No channels added yet";

    await ctx.editMessageText(
      `<b>⚙️ Hello, Welcome To The Channel Settings.</b>\n\n<b>🏷 Total Channels In Check</b> : ${channels.length}\n\n${channelsText}\n\nℹ️ <a href="t.me/BotsBazaar">This Bot Is Powered By BoTsBazaAr</a>`,
      {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: buttons },
        disable_web_page_preview: true,
      }
    );

    await ctx.answerCbQuery("✅ Channel has been moved.");
  } catch (err) {
    console.error(err);
    await ctx.answerCbQuery("⚠️ Error moving channel !", { show_alert: true });
  }
});

bot.action(/^\/check_if_admin (-?\d+)$/, authAdmin, async (ctx) => {
  try {
    const channelId = ctx.match[1];
    const botInfo = await bot.telegram.getMe();
    const res = await bot.telegram.getChatMember(channelId, botInfo.id);

    // Check if bot is admin/creator
    if (!["administrator", "creator"].includes(res.status)) {
      return ctx.answerCbQuery(
        "⚠️ The bot is not an admin in this channel.\n\nPlease promote it to check permissions.",
        { show_alert: true }
      );
    }

    const missingPermissions = [];
    if (!res.can_change_info) missingPermissions.push("Change Channel Info");
    if (!res.can_post_messages) missingPermissions.push("Post Messages");
    if (!res.can_delete_messages) missingPermissions.push("Delete Messages");

    if (missingPermissions.length > 0) {
      return ctx.answerCbQuery(
        `⚠️ The bot lacks these permissions:\n\n${missingPermissions.join(", ")}.\n\nPlease grant them.`,
        { show_alert: true }
      );
    } else {
      return ctx.answerCbQuery("✅ Bot has all necessary permissions.");
    }
  } catch (err) {
    let errorMsg = "⚠️ Error : ";
    if (err.code === 400) {
      errorMsg += "Bot is not in the channel. Add it first!";
    } else {
      errorMsg += err.description || "Unknown error occurred.";
    }
    await ctx.answerCbQuery(errorMsg, { show_alert: true });
  }
});

// ======= Add Channel =======
bot.action("/add_channels", authAdmin, async (ctx) => {
  ctx.deleteMessage();
  ctx.replyWithHTML(
    "Send the Channel ID to add :-\n\nForward a post from the channel to @userinfobot to get its ID.",
    {
      reply_markup: {
        keyboard: [[{ text: back_button }]],
        resize_keyboard: true,
      },
    }
  );
  create_response(ctx, "admin_channel_id");
});

// ======= Delete Channel =======
bot.action(/^\/delete_channel (.+)$/, authAdmin, async (ctx) => {
  await db.collection("admin").updateOne({ channels: 1 }, { $pull: { data: { id: ctx.match[1] } } });
  ctx.editMessageText("<b>✅ Channel deleted.</b>", {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "Go Back", callback_data: "/channels_settings" }]] },
  });
});



// ======= Manage Social Sites =======
bot.action('/manage_social_sites', authAdmin, async (ctx) => {
  let site_tab = await get_social_sites(ctx);
  ctx.editMessageText(site_tab.text, site_tab.markup).catch(err => console.log(err));
});

// add social sites
bot.action('/add_social_site', authAdmin, async (ctx) => {
  try {
    await ctx.deleteMessage();

    create_response(ctx, 'add_social');

    await ctx.replyWithHTML(
      `Send the link in this format :-\n\n<code>Button Name-Button URL</code>\n\nExample :\n<code>Follow Now-https://instagram.com/BoTsBazaAr</code>`,
      {
        reply_markup: {
          resize_keyboard: true,
          keyborad: [
            [{ text: cancel_button }]
          ]
        }
      }
    );
  } catch (err) {
    console.error('Error in /add_social_site:', err);
    await ctx.reply('❌ Failed to process request.');
  }
});

// delete social sites
bot.action(/^\/delete_social (.+)$/, authAdmin, async (ctx) => {
  try {
    let site_id = new ObjectId(ctx.match[1]);
    await db.collection('social_sites').deleteOne({ _id: site_id });
    let site_tab = await get_social_sites(ctx);
    await ctx.editMessageText(site_tab.text, site_tab.markup);
  } catch (err) {
    console.log('Error deleting social site :', err);
    await ctx.answerCbQuery(ERROR_MESSAGE, { show_alert: true });
  }
});

// move social sites up/down
bot.action(/\/move_social (\S+) (up|down)/, async (ctx) => {
  try {
    const [, socialId, direction] = ctx.match;
    let data = await db.collection('social_sites').find({}).toArray();
    const index = data.findIndex((ele) => ele._id.toString() === socialId);

    if (index === -1) return await ctx.answerCbQuery("⚠️ Link not found !", { show_alert: true });
    if (direction === "up" && index > 0) [data[index - 1], data[index]] = [data[index], data[index - 1]];
    if (direction === "down" && index < data.length - 1) [data[index], data[index + 1]] = [data[index + 1], data[index]];

    await db.collection('social_sites').deleteMany({});
    await db.collection('social_sites').insertMany(data);


    let site_tab = await get_social_sites(ctx, data);
    await ctx.editMessageText(site_tab.text, site_tab.markup);

    await ctx.answerCbQuery("✅ Link Has Been Moved !");
  } catch (error) {
    console.error("Error moving social link :", error.message);
    await ctx.answerCbQuery("⚠️ Error moving link !", { show_alert: true });
  }
});

bot.action("/channel_stats", authAdmin, async (ctx) => {
  try {
    // Fetch channel data from the database
    const adminDoc = await db.collection("admin").findOne(
      { channels: 1 },
      { projection: { data: 1, _id: 0 } }
    );

    if (!adminDoc?.data || adminDoc.data.length === 0) {
      return ctx.answerCbQuery("No channel data found !", { show_alert: true });
    }

    let message = "📊 <b>Channel Membership Report :-</b>\n\n";
    const labels = [];
    const joinedData = [];
    const leftData = [];

    // Function to get channel name and format as an inline link
    const getChannelInfo = async (channelID) => {
      try {
        const chat = await bot.telegram.getChat(channelID);
        let trimmedName = chat.title.replace(/[^\w\s]/g, "").trim().slice(0, 25) + "..";
        const channelLink = `<a href="${chat.invite_link}">${trimmedName}</a>`;
        return { name: trimmedName, link: channelLink };
      } catch (error) {
        console.error(`Error fetching channel name for ${channelID}:`, error);
        return { name: `Channel ${channelID}`, link: `Channel ${channelID}` };
      }
    };

    // Fetch channel names and create stats asynchronously
    const channelDataWithNames = await Promise.all(
      adminDoc.data.map(async (channel) => {
        const { name, link } = await getChannelInfo(channel.id);
        labels.push(name); // For chart labels
        joinedData.push(channel.joined || 0);
        leftData.push(channel.left || 0);

        message += `📌 ${link}\n`;
        message += `✅ Joined : ${channel.joined || 0}  ❌ Left : ${channel.left || 0}\n\n`;

        return { name, link, joined: channel.joined, left: channel.left };
      })
    );

    // Generate the chart configuration
    const chartConfig = JSON.stringify({
      type: "bar",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Joined",
            data: joinedData,
            backgroundColor: "rgba(54, 162, 235, 0.6)", // Blue
            borderColor: "rgba(54, 162, 235, 1)",
            borderWidth: 1
          },
          {
            label: "Left",
            data: leftData,
            backgroundColor: "rgba(255, 99, 132, 0.6)", // Red
            borderColor: "rgba(255, 99, 132, 1)",
            borderWidth: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: "Channel Membership Statistics",
            font: {
              size: 18,
              weight: "bold"
            }
          },
          legend: { position: "top" }
        },
        scales: {
          x: { beginAtZero: true }
        }
      }
    });

    // Generate the chart URL
    const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(chartConfig)}`;

    // Inline keyboard with a share button
    const inlineKeyboard = [
      [{
        text: "📢 Share Stats",
        url: `https://t.me/share/url?url=${encodeURIComponent("Channel Stats")}&text=${encodeURIComponent(message)}`
      }]
    ];

    // Send the message with the chart
    await ctx.replyWithPhoto({ url: chartUrl }, {
      caption: message,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: inlineKeyboard }
    });

  } catch (error) {
    console.error("Error fetching channel statistics:", error);
    ctx.answerCbQuery("⚠️ Unable to fetch channel statistics!", { show_alert: true });
  }
});

// Function to format user input to HTML-compatible text
function formatText(input) {
  return input
    .replace(/\*(.*?)\*/g, '<b>$1</b>')  // Convert *bold* to <b>bold</b>
    .replace(/_(.*?)_/g, '<i>$1</i>')    // Convert _italic_ to <i>italic</i>
    .replace(/``(.*?)``/g, '<code>$1</code>'); // Convert ``monospace`` to <code>monospace</code>
}

const taskScene = new Scenes.BaseScene('taskScene');

taskScene.enter((ctx) => {
  ctx.reply("Enter the Name of the Yono app.\n\nExample: <code>\ud83d\udc51 Yono King</code>", {
    parse_mode: 'HTML',
    reply_markup: {
      keyboard: [[{ text: 'Abort' }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });

  // Initialize scene state
  ctx.scene.state = {
    step: 'name',
    name: null,
    messageText: null,
    mediaUrl: null,
    isVideo: false,
  };
});

taskScene.on('text', async (ctx) => {
  const messageText = ctx.message.text.trim();

  // Handle task cancellation
  if (messageText === 'Abort') {
    const adminMarkup = await get_task_settings(ctx);
    await ctx.replyWithHTML('⚠️ Task setup cancelled.', { reply_markup: { remove_keyboard: true } });
    await ctx.replyWithHTML(adminMarkup.text, adminMarkup.markup);
    return ctx.scene.leave();
  }

  switch (ctx.scene.state.step) {
    // Step 1: Capture task name
    case 'name':
      if (!messageText) {
        return ctx.reply('⚠️ Invalid format! Use: TaskName (e.g., 👑 Yono King)', { parse_mode: 'HTML' });
      }
      ctx.scene.state.name = messageText;
      ctx.scene.state.step = 'message';
      return ctx.reply('Enter the content (or post message)\n\n⚠️ Please send only text messages (no images/media)', { parse_mode: 'HTML' });

    // Step 2: Capture message text
    case 'message':
      if (!messageText) {
        return ctx.reply('⚠️ Content cannot be empty.', { parse_mode: 'HTML' });
      }
      ctx.scene.state.messageText = formatText(messageText);
      ctx.scene.state.step = 'media';
      return ctx.reply('Enter image or video Telegram post URL:\n\n(e.g., https://t.me/FilesStoreBots/17).', { parse_mode: 'HTML', disable_web_page_preview: true });

    // Step 3: Capture and validate media URL
    case 'media':
      const mediaUrl = messageText;
      if (!/^https:\/\/.+/.test(mediaUrl)) {
        return ctx.reply('⚠️ Please enter a valid URL link!', { parse_mode: 'HTML' });
      }
      ctx.scene.state.mediaUrl = mediaUrl;

      // Generate task ID and insert into the database
      const taskId = generate_random_code(10);
      try {
        await db.collection('tasks').insertOne({
          _id: taskId,
          name: ctx.scene.state.name,
          messageText: ctx.scene.state.messageText,
          mediaUrl: ctx.scene.state.mediaUrl,
        });
      } catch (error) {
        console.error("Error inserting task:", error);
        return ctx.reply('⚠️ An error occurred while adding the task.', { parse_mode: 'HTML' });
      }

      await ctx.replyWithHTML('Main Menu', get_main_menu(ctx).markup);
      await ctx.replyWithHTML(
        `<b>✅ Task has been added.</b>\n\n`,
        {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [[{ text: "↩️ Go Back", callback_data: `edit_${taskId}` }]],
          },
        }
      );
      return ctx.scene.leave();
  }
});

const stage = new Scenes.Stage([taskScene]);
bot.use(stage.middleware());


// Function to display task
async function handleTaskDisplay(ctx) {
  try {
    const taskId = ctx.match[1];
    if (!taskId) {
      await ctx.answerCbQuery(`⚠️ Task Not Found !`, { show_alert: true });
      return;
    }

    const task = await db.collection('tasks').findOne({ _id: taskId });
    if (!task) {
      await ctx.answerCbQuery("⚠️ Task Not Found !", { show_alert: true });
      return;
    }

    const mediaData = {
      type: 'photo',
      media: task.mediaUrl,
      caption: task.messageText?.substring(0, 1024) || '',
      parse_mode: 'HTML'
    };

    await ctx.editMessageMedia(mediaData, {
      reply_markup: {
        inline_keyboard: [[{ text: "↩️ Go Back", callback_data: "Account" }]]
      }
    });
  } catch (error) {
    console.error("Error in handleTaskDisplay:", error);
    await ctx.answerCbQuery("⚠️ An error occurred!", { show_alert: true });
  }
}

bot.action(/task_(\w+)/, async (ctx) => {
  await handleTaskDisplay(ctx);
});



// Add task
bot.action("add_task", authAdmin, (ctx) => {
  ctx.deleteMessage().catch((err) => {
    console.log(err);
  });
  ctx.scene.enter("taskScene");
});

// Edit task
exports.handleEditTask = async (ctx, taskId) => {

  try {
    const task = await db.collection('tasks').findOne({ _id: taskId });
    if (!task) {
      await ctx.answerCbQuery(`⚠️ Task Not Found !`, { show_alert: true });
      return;
    }

    let contentNodes = [];
    if (task.mediaUrl) {
      contentNodes.push({ tag: 'img', attrs: { src: task.mediaUrl } });
    }

    if (task.messageText) {
      contentNodes.push({ tag: 'p', children: [task.messageText] });
    }

    let contentDisplay = "";

    if (task.messageText && task.messageText.length > 20) {
      const telegraphAccessToken = '880a6621bd3ee578dab6f7f3df79099c00daec5512aab63036f219489d71';
      try {

        const telegraphResponse = await axios.post('https://api.telegra.ph/createPage', {
          access_token: telegraphAccessToken,
          title: task.name || "Task Content",
          content: JSON.stringify([{ tag: 'p', children: [task.messageText] }]),
          author_name: "BoTs BazaAr",
          return_content: false
        });
        if (telegraphResponse.data && telegraphResponse.data.ok) {
          const pageUrl = telegraphResponse.data.result.url;
          contentDisplay = `<a href="${pageUrl}">View Full Content</a>`;
        } else {
          contentDisplay = task.messageText.substring(0, 200) + (task.messageText.length > 200 ? "..." : "");
        }
      } catch (telegraphError) {
        console.error("Error creating Telegraph page:", telegraphError);
        contentDisplay = task.messageText.substring(0, 200) + (task.messageText.length > 200 ? "..." : "");
      }
    } else {
      contentDisplay = task.messageText;
    }

    await ctx.editMessageText(`<b>⚙️ Hello, Manage App From Here.</b>\n\n▫️ Name : ${task.name || 'NA'}\n▫️ Media URL : ${task.mediaUrl ? `<a href="${task.mediaUrl}">View URL</a>` : 'Not Set'}\n\n▫️ Post Content : ${contentDisplay}`, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [
          [{ text: "Edit App Name", callback_data: `editname_${taskId}` }],
          [{ text: "Edit Media URL", callback_data: `editmedia_${taskId}` }, { text: "Edit Post Content", callback_data: `editmessage_${taskId}` }],
          [{ text: "⚠️ Delete App", callback_data: `delete_${taskId}` }],
          [{ text: '↩️ Go Back', callback_data: '/task_settings' }],
        ]
      }
    });
  } catch (error) {
    console.error("Error fetching edit task details:", error);
    await ctx.answerCbQuery(ERROR_MESSAGE, { show_alert: true });
  }
};

bot.action(/edit_(.+)/, async (ctx) => {
  const taskId = ctx.match[1];
  await this.handleEditTask(ctx, taskId);
});

bot.action(/editname_(.+)/, async (ctx) => {
  try {
    const taskId = ctx.match[1];

    if (!taskId) {
      await ctx.answerCbQuery(`⚠️ Task Not Found !`, { show_alert: true });
      return;
    }

    await ctx.deleteMessage();

    await ctx.replyWithHTML("Send the new task name to set :-", {
      reply_markup: {
        keyboard: [[{ text: cancel_button }]],
        resize_keyboard: true,
      },
    });

    create_response(ctx, 'admin_edit_task_name', { taskId });

  } catch (error) {
    console.error("Error in editname action:", error);
    await ctx.answerCbQuery(ERROR_MESSAGE, { show_alert: true });
  }
});

bot.action(/editmedia_(.+)/, async (ctx) => {
  try {
    const taskId = ctx.match[1];

    if (!taskId) {
      await ctx.answerCbQuery(`⚠️ Task Not Found !`, { show_alert: true });
      return;
    }

    await ctx.deleteMessage();

    await ctx.replyWithHTML("Send the New Media URL to Set :-", {
      reply_markup: {
        keyboard: [[{ text: cancel_button }]],
        resize_keyboard: true,
      },
    });

    create_response(ctx, 'admin_edit_task_mediaURL', { taskId });

  } catch (error) {
    console.error("Error in editmedia action :", error);
    await ctx.answerCbQuery(ERROR_MESSAGE, { show_alert: true });
  }
});

bot.action(/editmessage_(.+)/, async (ctx) => {
  try {
    const taskId = ctx.match[1];

    if (!taskId) {
      await ctx.answerCbQuery(`⚠️ Task Not Found !`, { show_alert: true });
      return;
    }

    await ctx.deleteMessage();

    await ctx.replyWithHTML("Send the new Content to Set :-", {
      reply_markup: {
        keyboard: [[{ text: cancel_button }]],
        resize_keyboard: true,
      },
    });

    create_response(ctx, 'admin_edit_task_message', { taskId });

  } catch (error) {
    console.error("Error in editmessage action:", error);
    await ctx.answerCbQuery(ERROR_MESSAGE, { show_alert: true });
  }
});


// delete task
bot.action(/delete_(.+)/, async (ctx) => {
  try {
    const taskId = ctx.match[1];

    if (!taskId) {
      await ctx.answerCbQuery(`⚠️ Task Not Found !`, { show_alert: true });
      return;
    }

    const task = await db.collection('tasks').findOne({ _id: taskId });
    if (!task) {
      await ctx.answerCbQuery(`⚠️ Task Not Found !`, { show_alert: true });
      return;
    }

    await db.collection('tasks').deleteOne({ _id: taskId });
    await ctx.answerCbQuery("✅ Task deleted.", { show_alert: true });

    await handleAdminAction(ctx, get_task_settings, "/task_settings");
  } catch (error) {
    console.error(error);
    await ctx.answerCbQuery(ERROR_MESSAGE, { show_alert: true });
  }
});

