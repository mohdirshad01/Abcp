// ----- Imports (CommonJs) ---- // 
const bot = require('./bot.js');
const { paginate, getCombinedAdmins } = require('./functions.js');
const { db } = require('./index.js');


// ======== Bot On/Off Status Check ========
exports.botStatus = async (ctx, next) => {
    try {
        if (!ctx?.from?.id) return; // Ensure a valid user ID exists

        // If the user is an admin, bypass the bot status check
        const combinedAdmins = await getCombinedAdmins();
        if (combinedAdmins.has(String(ctx.from.id))) {
            return next();
        }

        // Initialize global.bot_status if it hasn't been set
        if (typeof global.bot_status === "undefined") {
            const botStatusData = await db.collection('admin').findOne(
                { admin: 1 },
                { projection: { botStatus: 1 } }
            ) || {};

            if (typeof botStatusData.botStatus === "string") {
                global.bot_status = botStatusData.botStatus.toLowerCase() === "on";
            } else {
                global.bot_status = botStatusData.botStatus !== undefined
                    ? Boolean(botStatusData.botStatus)
                    : true;
            }
        }

        // If the bot is turned off, stop processing further middleware
        if (!global.bot_status) return;

        await next();
    } catch (error) {
        console.error(`Error in botStatus middleware: ${error.message}`);
        ctx.reply(`⚠️ Something went wrong !`);
    }
};



// ======== User's Ban/Unban Check ========
exports.check_user = async (ctx, next) => {
    try {
        if (!ctx?.from?.id) return;
        const userId = ctx.from.id;

        // If the user is an admin, bypass the ban check
        const combinedAdmins = await getCombinedAdmins();
        if (combinedAdmins.has(String(userId))) return next();

        // If the user is an banned, return
        const userData = await db.collection('users').findOne({ user_id: userId }, { projection: { banned: 1 } });
        if (userData?.banned) return;

        await next();
    } catch (error) {
        console.error(`Error in check_user middleware:`, error);
        ctx.reply(`⚠️ Something went wrong !`);
    }
};


// ======== Authorize Admin Chat Id's ======== //
exports.authAdmin = async (ctx, next) => {
    try {

        // If the user is an admin, proceed to next middleware
        const combinedAdmins = await getCombinedAdmins();
        if (!combinedAdmins.has(String(ctx.from?.id))) return;

        await next();
        return { status: true };
    } catch (error) {
        console.error('Error in check admin middleware:', error);
        await ctx.reply('⚠️ Something went wrong !');
    }
};


// ======== /Start Check Verification Statuses ======== //
exports.check_join = async (ctx, next) => {
    try {
        // Retrieve channels from admin collection
        const channelData = await db.collection('admin').findOne(
            { channels: 1 },
            { projection: { data: 1 } }
        );
        const channels = channelData?.data || [];

        // Check user's membership status for each channel
        const membershipResults = await Promise.all(
            channels.map(async (channel) => {
                try {
                    const member = await ctx.telegram.getChatMember(channel.id, ctx.from.id);
                    return { id: channel.id, status: member.status };
                } catch (error) {
                    return {
                        id: channel.id,
                        status: 'error',
                        description: error.response?.description || "Couldn't check channel."
                    };
                }
            })
        );

        // Determine if the user has not joined at least one channel or if an error occurred
        const userHasNotJoined = membershipResults.some(({ status }) =>
            ['left', 'kicked', 'error'].includes(status)
        );

        if (userHasNotJoined) {
            // Fetch invite links for all channels (ignoring channels where export fails)
            const inviteLinks = (
                await Promise.all(
                    channels.map(async (channel) => {
                        try {
                            const result = await bot.telegram.getChat(channel.id);
                            return result.invite_link
                        } catch {
                            return false;
                        }
                    })
                )
            ).filter(Boolean);

            // Build the inline keyboard markup with social and invite links
            let markup = [];
            const socialLinks = await db.collection('social_sites').find({}).toArray();
            socialLinks.forEach(site => {
                markup.push({ text: site.button_text, url: site.url });
            });
            inviteLinks.forEach(link => {
                markup.push({ text: 'Join', url: link });
            });
            markup = paginate(markup, 2);

            markup.push([{ text: '↪️ Continue', callback_data: 'check_join' }]);

            const notJoinedText = `<b>All Yono Apps - ₹100-₹500 BIG PromoCode's Added in Bot 😱👇\n\n❤️ Join All Channel's To Claim All BIG Yono PromoCode's 👇👇</b>`;
            await ctx.telegram.sendPhoto(ctx.from.id, "https://t.me/AllYonoBonus/44", {
                caption: notJoinedText,
                reply_markup: { inline_keyboard: markup },
                parse_mode: 'HTML'
            });
            return;
        }

        // If everything is okay, attach the results and proceed
        ctx.check_join = { status: true, results: membershipResults };
        await next();
    } catch (error) {
        console.error('Error in check_join middleware:', error);
    }
};


