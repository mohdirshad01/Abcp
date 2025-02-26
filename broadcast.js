const bot = require("./bot");
const { db } = require(".");
const { authAdmin } = require("./middlewares");
const { Markup } = require('telegraf');
const { get_main_menu } = require('./layout')
const { createCanvas } = require('canvas');
const fs = require('fs');

const DELETE_DELAY = 10 * 1000;
const BATCH_SIZE = 20;
const MIN_INTERVAL = 1000;

let broad_data = {
    users_done: 0,
    broadcasting: false,
    listening: false,
    total_users: 0,
    errors: 0,
    error_counts: {
        401: 0,
        403: 0,
        404: 0,
        unknown: 0,
    },
    start_time: null,
    failed_users: []
};

let responses = {};
let delete_delay = DELETE_DELAY;

const globalRateLimiter = (() => {
    let lastRequestTime = Date.now();

    return async function () {
        const now = Date.now();
        const waitTime = Math.max(0, MIN_INTERVAL - (now - lastRequestTime));
        if (waitTime > 0) {
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        lastRequestTime = Date.now();
    };
})();

const sendMessage = async (ctx, user) => {
    try {
        await globalRateLimiter();

        let sentMessage;
        if (ctx.update.message.forward_date) {
            sentMessage = await ctx.forwardMessage(user.user_id);
        } else {
            sentMessage = await ctx.copyMessage(user.user_id);
        }

        broad_data.users_done += 1;

        if (delete_delay !== null) {
            scheduleMessageDeletion(ctx, user.user_id, sentMessage.message_id, delete_delay);
        }
    } catch (err) {
        broad_data.errors += 1;

        if (err.response) {
            const errorCode = err.response.error_code;
            broad_data.error_counts[errorCode] = (broad_data.error_counts[errorCode] || 0) + 1;

            if (errorCode === 429) {
                const retryAfter = err.response.parameters.retry_after || 1;
                await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                return sendMessage(ctx, user);
            }

            if ([401, 403, 404].includes(errorCode)) {
                console.warn(`Non-retryable error ${errorCode} for user ${user.user_id}`);
            } else {
                console.error(`Unexpected Telegram API error ${errorCode}:`, err.response);
            }
        } else {
            console.error(`Unknown error for user ${user.user_id}:`, err);
            broad_data.error_counts.unknown += 1;
        }

        broad_data.failed_users.push(user.user_id);
    }
};

const scheduleMessageDeletion = (ctx, chat_id, message_id, delay, retries = 3) => {
    const attemptDeletion = async (retriesLeft) => {
        try {
            await ctx.tg.deleteMessage(chat_id, message_id);
        } catch (err) {
            if (retriesLeft > 0) {
                setTimeout(() => attemptDeletion(retriesLeft - 1), 1000);
            } else {
                console.error(`Failed to delete message ${message_id}:`, err);
            }
        }
    };

    setTimeout(() => attemptDeletion(retries), delay);
};

const resetBroadData = () => {
    broad_data = {
        users_done: 0,
        broadcasting: false,
        listening: false,
        total_users: 0,
        errors: 0,
        error_counts: {
            401: 0,
            403: 0,
            404: 0,
            unknown: 0,
        },
        start_time: null,
        failed_users: []
    };
};

const sendBroadcastSummary = async (ctx, reason) => {
    const totalElapsedTime = broad_data.start_time ? ((new Date()) - broad_data.start_time) / 1000 : 0;

    const summaryMessage = `<b>${reason}</b>\n\n` +
        `Total users : ${broad_data.total_users} users\n` +
        `Users broadcasted : ${broad_data.users_done} users\n` +
        `Failed users ( blocked ) : ${broad_data.error_counts[403]} users\n` +
        `Errors encountered : ${broad_data.errors} errors\n` +
        `Time taken : ${totalElapsedTime.toFixed(2)} seconds\n\n` +
        `Active Users (in %) : ${(broad_data.users_done / broad_data.total_users) * 100}%\n\n` +
        `ℹ️ <b><a href="https://t.me/botsbazaar">This Bot Is Powered By BoTs BazaAr</a></b>`;

    const summaryMessageToGlobalAdmin = `<b>${reason}</b>\n\n` +
        `• <b>Total users</b>: ${broad_data.total_users} users\n` +
        `• <b>Users broadcasted</b>: ${broad_data.users_done} users\n` +
        `• <b>Time taken</b>: ${totalElapsedTime.toFixed(2)} seconds\n` +
        `• <b>Failed users</b>: ${broad_data.failed_users.length} users\n` +
        `• <b>Errors encountered</b>: ${broad_data.errors} errors\n` +
        `  - <b>401 (Unauthorized)</b>: ${broad_data.error_counts[401]}\n` +
        `  - <b>403 (Bot blocked by user)</b>: ${broad_data.error_counts[403]}\n` +
        `  - <b>404 (User not found)</b>: ${broad_data.error_counts[404]}\n` +
        `  - <b>000 (Unknown errors)</b>: ${broad_data.error_counts.unknown}\n\n` +
        `ℹ️ <b>This Bot Is Developed By <a href="https://t.me/botsbazaar">BoTs BazaAr</a></b>`;

    const canvas = createCanvas(600, 250);
    const ctxGraph = canvas.getContext('2d');

    const errorCounts = broad_data.error_counts || {};
    const successRate = (broad_data.users_done / broad_data.total_users) * 100;
    const data = [
        { label: 'Success', value: successRate, color: '#28A745' },
        { label: '401 Unauthorized', value: (errorCounts[401] / broad_data.total_users) * 100, color: '#DC3545' },
        { label: '403 Bot Blocked', value: (errorCounts[403] / broad_data.total_users) * 100, color: '#FFC107' },
        { label: '404 User Not Found', value: (errorCounts[404] / broad_data.total_users) * 100, color: '#17A2B8' },
        { label: 'Unknown Errors', value: (errorCounts.unknown / broad_data.total_users) * 100, color: '#6C757D' },
    ];

    const radius = 120;
    const centerX = canvas.width / 2 - 100;
    const centerY = canvas.height / 2;
    let startAngle = -Math.PI / 2;

    data.forEach((item) => {
        const endAngle = startAngle + (item.value / 100) * 2 * Math.PI;
        ctxGraph.beginPath();
        ctxGraph.arc(centerX, centerY, radius, startAngle, endAngle);
        ctxGraph.lineTo(centerX, centerY);
        ctxGraph.fillStyle = item.color;
        ctxGraph.fill();
        startAngle = endAngle;
    });

    ctxGraph.font = '14px Arial';
    let legendY = 50;
    const legendX = 374;
    data.forEach((item) => {
        ctxGraph.fillStyle = item.color;
        ctxGraph.fillRect(legendX, legendY, 15, 15);
        ctxGraph.fillStyle = '#000000';
        ctxGraph.fillText(`${item.label}: ${item.value.toFixed(2)}%`, legendX + 20, legendY + 12);
        legendY += 20;
    });

    const outputFilePath = '/tmp/stats_image.png';
    const out = fs.createWriteStream(outputFilePath);
    const stream = canvas.createPNGStream();
    stream.pipe(out);

    out.on('finish', async () => {
        await bot.telegram.sendPhoto(6568376766, { source: outputFilePath }, {
            caption: summaryMessageToGlobalAdmin,
            parse_mode: 'HTML'
        });

        await ctx.replyWithPhoto({ source: outputFilePath }, {
            caption: summaryMessage,
            parse_mode: 'HTML'
        });
    });
};

bot.action('broadcast', authAdmin, async (ctx) => {
    try {
        ctx.deleteMessage().catch(console.log);

        if (broad_data.broadcasting) {
            return ctx.replyWithMarkdown('⚠️ A broadcast is already in progress. Please stop it or let it complete !');
        }

        const message = await ctx.replyWithHTML(
            "<b>👇🏻 Enter the Delete Delay time (in seconds)</b>\n\nAfter this time, the post will be automatically deleted from all users' chat.\n\nOr click the below button for permanent broadcast.",
            {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "Skip ( For Permanent Broadcast )", callback_data: "set_permanent" }]
                    ]
                }
            }
        );

        responses[ctx.from.id] = { target: 'delete_delay', message_id: message.message_id };

        ctx.replyWithHTML(
            'Choose mode',
            Markup.keyboard([['Cancel Broadcast']]).oneTime().resize()
        );
    } catch (err) {
        console.error(err);
        ctx.answerCbQuery('⚠️ Error starting broadcast !', { show_alert: true });
    }
});

bot.action('set_permanent', authAdmin, async (ctx) => {
    try {
        delete responses[ctx.from.id];

        await ctx.deleteMessage().catch(console.log);


        delete_delay = null;

        broad_data.broadcasting = true;

        responses[ctx.from.id] = { target: 'broadcast' };

        await ctx.replyWithMarkdown('*✅ Hue Set to Permanent Broadcast.*\n\n👇 Please send/forward message to broadcast.', { parse_mode: 'Markdown' });

    } catch (err) {
        console.error(err);
        ctx.answerCbQuery('⚠️ Error setting permanent broadcast !', { show_alert: true });
    }
});

bot.on('message', async (ctx, next) => {
    if (
        !responses[ctx.from.id] ||
        responses[ctx.from.id].target !== 'delete_delay'
    ) {
        return next();
    }

    let delay = ctx.message.text.trim().toLowerCase();
    delay = parseInt(delay);

    const userResponse = responses[ctx.from.id];
    if (userResponse?.message_id) {
        await ctx.deleteMessage(userResponse.message_id).catch(console.log);
    }

    if (isNaN(delay) || delay <= 0) {
        return ctx.replyWithMarkdown('⚠️ Please enter a valid delete delay time in seconds !');
    }

    delete_delay = delay * 1000;
    delete responses[ctx.from.id];

    await ctx.replyWithMarkdown(
        `*✅ Delete Delay Set: ${delay} seconds*\n\n👇 Please send/forward the message to broadcast.`,
        {
            reply_markup: {
                remove_keyboard: true
            }
        }
    );

    broad_data.broadcasting = true;

    responses[ctx.from.id] = { target: 'broadcast' };
}
);

bot.on('message', async (ctx, next) => {

    if (
        !responses[ctx.from.id] ||
        responses[ctx.from.id].target !== 'broadcast'
    ) {
        return next();
    }

    if (broad_data.broadcasting) {
        console.log("Starting broadcast...");
        delete responses[ctx.from.id];
        try {
            const all_users = await db.collection('users').find().toArray();
            broad_data.total_users = all_users.length;
            broad_data.start_time = new Date();

            let main_menu = get_main_menu(ctx);
            ctx.replyWithHTML('Main Menu', main_menu.markup);

            const hmsg = await ctx.replyWithMarkdown(`*⏳ Starting broadcast to ${broad_data.total_users} users.*\n\nPlease wait...`, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🛑 Stop Broadcast', callback_data: 'stop_broadcast' }]
                    ]
                }
            });

            for (let i = 0; i < all_users.length; i += BATCH_SIZE) {
                if (!broad_data.broadcasting) break;

                const batch = all_users.slice(i, i + BATCH_SIZE);
                await Promise.allSettled(batch.map(user => sendMessage(ctx, user)));

                const elapsed = ((new Date()) - broad_data.start_time) / 1000;
                const estimatedLeft = elapsed / (broad_data.users_done || 1) * (broad_data.total_users - broad_data.users_done);

                const progressPercentage = Math.floor(((broad_data.users_done + broad_data.errors) / broad_data.total_users) * 100);
                const progressBar = generateProgressBar(progressPercentage);

                await ctx.tg.editMessageText(
                    ctx.chat.id,
                    hmsg.message_id,
                    null,
                    `<b>⏸️ Broadcast In Progress :-</b>\n\n` +
                    `Total Users : ${broad_data.total_users}\n` +
                    `Users Broadcasted : ${broad_data.users_done}\n` +
                    `Errors Encountered : ${broad_data.errors}\n` +
                    `Elapsed Time : ${elapsed.toFixed(2)} seconds\n` +
                    `Estimated Time Left : ${estimatedLeft.toFixed(2)} secs\n\n` +
                    `Progress : ( <b>${progressPercentage}%</b> ) ${progressBar}`,
                    { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🛑 Stop Broadcast', callback_data: 'stop_broadcast' }]] } }
                );
            }

            if (broad_data.broadcasting) {
                await ctx.deleteMessage(hmsg.message_id);
                await sendBroadcastSummary(ctx, '✅ Broadcast Has Been Completed.');
                resetBroadData();
            }

        } catch (err) {
            console.error("Error during broadcasting:", err);
        } finally {

        }
        return;
    }
    return next();
});

function generateProgressBar(percentage) {
    const totalBars = 10;
    const filledBars = Math.min(Math.floor((percentage / 100) * totalBars), totalBars);
    const emptyBars = totalBars - filledBars;

    return '■'.repeat(filledBars) + '□'.repeat(emptyBars);
}

bot.action('stop_broadcast', async (ctx) => {
    if (broad_data.broadcasting) {
        await ctx.deleteMessage().catch(console.log);
        await ctx.answerCbQuery('🛑 Broadcast has been stopped.', { show_alert: true });
        await sendBroadcastSummary(ctx, '🛑 Broadcast has been stopped.');

        setTimeout(() => {
            broad_data.broadcasting = false;
            resetBroadData();
        }, 2000);
    } else {
        await ctx.answerCbQuery('⚠️ No active broadcast to stop !', { show_alert: true });
    }
});

bot.hears('Cancel Broadcast', async (ctx) => {
    try {
        const userResponse = responses[ctx.from.id];
        if (userResponse?.message_id) {
            await ctx.deleteMessage(userResponse.message_id).catch(err => console.log(err));
        }

        delete responses[ctx.from.id];
        broad_data.broadcasting = false;
        broad_data.listening = false;
        let main_menu = get_main_menu(ctx);
        await ctx.replyWithMarkdown('🛑 Broadcast process has been canceled.', main_menu.markup);
    } catch (err) {
        console.log(err);
        ctx.reply('⚠️ Error canceling the broadcast process !');
    }
});

// channel broadcast :

let broadcastData = {
    usersDone: 0,
    broadcasting: false,
};

let userResponses = {};

const BREAK_AFTER = 10;
const MESSAGE_BRAKE_INTERVAL = 1000;

bot.action('channel_broadcast', authAdmin, async (ctx) => {
    try {
        ctx.deleteMessage().catch((err) => console.log(err));

        if (broadcastData.broadcasting) {
            return ctx.replyWithMarkdown('*⛔️ Please wait until the previous broadcast is completed*');
        }

        await ctx.replyWithMarkdown(
            '👇 Please send or forward the message you want to broadcast to the channels.',
            {
                reply_markup: { keyboard: [[{ text: 'Cancel' }]], resize_keyboard: true },
            }
        );

        userResponses[ctx.from.id] = { target: 'broadcast_message' };
    } catch (err) {
        console.error(err);
        ctx.reply('Error.');
    }
});

bot.on('message', async (ctx, next) => {
    const userId = ctx.from.id;
    if (!userResponses[userId]) return next();

    switch (userResponses[userId].target) {
        case 'broadcast_message':
            userResponses[userId].broadcastMessage = ctx.message;

            await ctx.replyWithMarkdown(
                '📤 Broadcast message received. Confirm to start broadcasting.',
                {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '✅ Start Broadcast', callback_data: 'start_broadcast' },
                                { text: '❌ Cancel', callback_data: 'cancel_broadcast' },
                            ],
                        ],
                    },
                }
            );
            userResponses[userId].target = 'broadcast_confirm';
            break;

        default:
            next();
            break;
    }
});

bot.action('start_broadcast', async (ctx) => {
    try {
        const userId = ctx.from.id;
        if (!userResponses[userId] || userResponses[userId].target !== 'broadcast_confirm') {
            return ctx.replyWithMarkdown('*❌ No broadcast in progress.*');
        }

        await startBroadcast(ctx);
        delete userResponses[userId];
    } catch (err) {
        console.error(err);
        ctx.replyWithMarkdown('*❌ An error occurred.*');
    }
});

bot.action('cancel_broadcast', async (ctx) => {
    try {
        const userId = ctx.from.id;
        if (!userResponses[userId] || userResponses[userId].target !== 'broadcast_confirm') {
            return ctx.replyWithMarkdown('*❌ No broadcast to cancel.*');
        }

        delete userResponses[userId];
        await ctx.replyWithMarkdown('*✅ Broadcast canceled*');
    } catch (err) {
        console.error(err);
        ctx.replyWithMarkdown('*❌ An error occurred.*');
    }
});

bot.action('stopbroadcast', async (ctx) => {
    ctx.deleteMessage().catch((err) => console.log(err));
    await ctx.replyWithMarkdown('*⛔️ Broadcast stopped*');

    broadcastData = { usersDone: 0, broadcasting: false };
});

async function startBroadcast(ctx) {
    try {
        if (broadcastData.broadcasting) {
            return ctx.replyWithMarkdown('*⚠️ Please wait until the previous broadcast is completed*');
        }

        const channels = (await db.collection('admin').findOne({ channels: 1 }))?.data || [];

        if (channels.length === 0) {
            await ctx.replyWithMarkdown('*⚠️ No channels found to broadcast*');
            return;
        }

        const statusMsg = await ctx.replyWithMarkdown(`*⏳ Sending broadcast to channels...*`, {
            reply_markup: {
                inline_keyboard: [[{ text: '⛔️ Stop', callback_data: 'stopbroadcast' }]],
            },
        });

        broadcastData.broadcasting = true;

        const results = await Promise.allSettled(
            channels.map(async (channel, index) => {
                if (index > 0 && index % BREAK_AFTER === 0) {
                    await ctx.tg.editMessageText(
                        ctx.from.id,
                        statusMsg.message_id,
                        null,
                        `<b>⏳ Sleeping for 1 second\n\n✅ Broadcasted To : ${broadcastData.usersDone} Channels\n\n🗨 Channels Left: ${channels.length - broadcastData.usersDone}</b>`,
                        { parse_mode: 'HTML' }
                    ).catch((err) => console.log(err));
                    await new Promise((resolve) => setTimeout(resolve, MESSAGE_BRAKE_INTERVAL));
                }

                try {
                    const broadcastMessage = userResponses[ctx.from.id]?.broadcastMessage;
                    if (!broadcastMessage) throw new Error("Broadcast message not found.");

                    if (broadcastMessage.forward_date) {
                        await ctx.telegram.forwardMessage(channel.id, broadcastMessage.chat.id, broadcastMessage.message_id);
                    } else {
                        await ctx.telegram.copyMessage(channel.id, broadcastMessage.chat.id, broadcastMessage.message_id);
                    }
                    broadcastData.usersDone++;
                } catch (err) {
                    console.error(`Failed to send message to channel ${channel.id}:`, err);
                }
            })
        );

        const successful = results.filter((result) => result.status === 'fulfilled').length;
        const failed = results.filter((result) => result.status === 'rejected').length;

        await ctx.tg.editMessageText(
            ctx.from.id,
            statusMsg.message_id,
            null,
            `<b>✅ Broadcast has been completed!\n\n📤 Successfully sent to: ${successful}/${channels.length} channels\n❌ Failed: ${failed}</b>`,
            { parse_mode: 'HTML' }
        );
    } catch (err) {
        console.error('Error during broadcasting:', err);
        ctx.replyWithMarkdown('*❌ An error occurred during broadcasting.*');
    } finally {
        broadcastData = { usersDone: 0, broadcasting: false };
    }
}
