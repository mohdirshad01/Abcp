const { db } = require(".");

const buildResponse = (text, keyboard) => ({
    text,
    markup: {
        reply_markup: { inline_keyboard: keyboard },
        parse_mode: 'HTML',
        disable_web_page_preview: true,
    }
});

exports.get_main_menu = (ctx) => ({
    text: `<b>Main Menu</b>`,
    markup: {
        reply_markup: {
            keyboard: [
                [{ text: 'Code' }],
            ],
            resize_keyboard: true,
        },
        parse_mode: 'HTML'
    }
});

const getAdminData = async (ctx, adminData) => {
    if (!adminData) {
        adminData = await db.collection('admin').findOne({ admin: 1 }) || {};
    }
    return adminData;
};

exports.get_admin = async (ctx, adminData) => {
    try {
        adminData = await getAdminData(ctx, adminData);
        const statusData = await db.collection('admin').findOne({ status: 1 }) || { total_users: 0 };
        const keyboard = [
            [{ text: `${adminData.bot_off ? '🟢 Enable' : '⚠️ Disable'} Bot`, callback_data: '/change_bot_status' }],

            [{ text: 'User Details & Settings', callback_data: '/user_settings' }],
            [
                { text: 'Manage Apps', callback_data: '/task_settings' },
                { text: 'Manage Admins', callback_data: '/admin_settings' }
            ],

            [{ text: 'Get Bot Statistics & Analysis', callback_data: '/top_stats' }],

            [
                { text: 'Users Broadcast', callback_data: 'broadcast' },
                { text: 'Channels Broadcast', callback_data: 'channel_broadcast' }
            ],
            [
                { text: 'Manage Channels', callback_data: '/channels_settings' },

            ],
            [
                { text: 'Manage Social Links', callback_data: '/manage_social_sites' },

            ]
        ];
        const startTime = Date.now();
        await ctx.telegram.getMe();
        const responseTime = Date.now() - startTime;
        const text = `<b>⚙️ Hello Admin, Welcome To Bot Settings.</b>\n\n` +
            `<b>▫️ Bot Status</b> : ${adminData.bot_off ? '⚠️ Disabled' : '🟢 Live'} (Ping : ${responseTime} ms)\n\n` +
            `<b>▫️ Total Users</b> : ${adminData.total_users} users` +
            `<b>▫️ Active Users</b> : !`;

        return buildResponse(text, keyboard);
    } catch (error) {
        console.error('Error in get_admin :', error);
        await ctx.answerCbQuery(`⚠️ Something went wrong !`, { show_alert: true });
    }
};
exports.get_user_settings_tab = async (ctx, userID, userData) => {
    try {
        userData = userData || await db.collection('users').findOne({ user_id: userID });
        if (!userData) return { text: "⚠️ User not found in bot database.", keyboard: { reply_markup: { inline_keyboard: [] } } };

        const url = `tg://user?id=${userID}`;
        const userName = userData.userName
            ? `@${userData.userName}`
            : (userData.firstName || 'Unknown');


        let keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: `${userData.banned ? '🟢 Unban User' : '⚠️ Ban User'}`, callback_data: `/change_ban ${userData.user_id}` }],
                    [{ text: 'Channel Status', callback_data: `/check_status ${userData.user_id}` }, { text: 'Send Message', callback_data: `/reply ${userData.user_id}` }],
                    [{ text: '↩️ Go Back', callback_data: '/admin' }],
                ]
            },
            parse_mode: 'HTML',
            disable_web_page_preview: true,
        };

        let text = `<b>⚙️ Hello, Welcome To User Settings.</b>\n\n` +
            `👤 <b>User</b> : <a href="${url}">${userName}</a>\n\n` +
            `ℹ️ <a href="https://t.me/BoTsBazaAr/78">This Bot Is Powered By BoTsBazaAr</a>`;

        return { text, keyboard };
    } catch (error) {
        console.error("Error in get_user_settings_tab :", error);
        await ctx.reply("⚠️ Failed to load user settings.");

        return { text: "⚠️ Something went wrong !", keyboard: { reply_markup: { inline_keyboard: [] } } };
    }
};


exports.get_task_settings = async (ctx, adminData) => {
    try {
        adminData = await getAdminData(ctx, adminData);
        const tasks = await db.collection('tasks').find().toArray();

        const cumulativeStats = tasks.reduce(
            (stats, task) => {
                stats.totalTasks++;
                stats.totalScreenshots += task.totalScreenshots || 0;
                stats.approvedScreenshots += task.approvedScreenshots || 0;
                stats.rejectedScreenshots += task.rejectedScreenshots || 0;
                return stats;
            },
            { totalTasks: 0, totalScreenshots: 0, approvedScreenshots: 0, rejectedScreenshots: 0 }
        );

        // Arrange tasks in a two-buttons-per-row format
        let keyboard = [];
        for (let i = 0; i < tasks.length; i += 2) {
            let row = [{ text: tasks[i].name, callback_data: `edit_${tasks[i]._id}` }];
            if (tasks[i + 1]) {
                row.push({ text: tasks[i + 1].name, callback_data: `edit_${tasks[i + 1]._id}` });
            }
            keyboard.push(row);
        }

        // Add control buttons
        keyboard.push([{ text: "➕ Add App", callback_data: "add_task" }]);
        keyboard.push([{ text: "↩️ Go Back", callback_data: "/admin" }]);

        let text = `<b>⚙️ Hello, Welcome To The Apps Settings.</b>\n\n` +
            `🏷 <b>Total Live Apps</b> : ${cumulativeStats.totalTasks} task(s)\n\n`;

        return buildResponse(text, keyboard);
    } catch (error) {
        console.error("Error in get_task_settings: ", error);
        await ctx.answerCbQuery(`⚠️ Something went wrong !`, { show_alert: true });
    }
};


exports.get_admin_settings = async (ctx, adminData) => {
    try {
        adminData = await getAdminData(ctx, adminData);
        const admins = adminData.admins || [];

        const adminListText = admins.length > 0
            ? admins.map((admin, index) => `${index + 1}. ${admin}`).join('\n')
            : "";

        let keyboard = admins.map((admin) => [
            { text: admin.toString(), callback_data: 'void' },
            { text: 'Remove ❌', callback_data: `/remove_admin_${admin}` }
        ]);
        keyboard.push([{ text: "➕ Add Admin", callback_data: "/add_admin" }]);
        keyboard.push([{ text: "↩️ Go Back", callback_data: "/admin" }]);

        let text = `<b>⚙️ Hello, Welcome To Admin Settings.</b>\n\n` +
            `👨🏻‍💻 <b>Total Admins Added</b> : ${admins.length}\n\n${adminListText}`;

        return buildResponse(text, keyboard);
    } catch (error) {
        console.error("Error in get_admin_settings:", error);
        await ctx.answerCbQuery("⚠️ Something went wrong !", { show_alert: true });
    }
};

exports.get_top_stats = async (ctx, adminData) => {
    try {
        adminData = await getAdminData(ctx, adminData);
        let keyboard = [
            [{ text: 'Bot Performance Dashboard', callback_data: '/bot_stats' }],
            [{ text: 'Channel Wise Stats', callback_data: '/channel_stats' }],
            [{ text: '↩️ Go Back', callback_data: '/admin' }]
        ];

        let text = `<b>📊 View Bot's Live Stats & Analysis.</b>\n\n` +
            `▫️ Get separate join stats for each channel.\n\n`;

        return buildResponse(text, keyboard);
    } catch (error) {
        console.error("Error in get_top_stats :", error);
        await ctx.answerCbQuery("⚠️ Something went wrong !", { show_alert: true });
    }
};

exports.get_social_sites = async (ctx, data) => {
    try {
        data = data || await db.collection('social_sites').find({}).toArray();
        let text = `<b>⚙️ Hello, Welcome To Social Settings.</b>\n\n` +
            `▫️ <b>Total Extra Links Added</b> : ${data.length}\n\n` +
            (data.length
                ? data.map((ele, index) => `${index + 1}: <b>${ele.button_text}</b> - <a href="${ele.url}">${ele.url}</a>`).join('\n')
                : `<i>No extra link added yet.</i>`);

        let keyboard = data.map((ele, index) => [
            { text: `${index + 1}`, callback_data: `/edit_social ${ele._id.toString()}` },
            { text: "⬆️", callback_data: `/move_social ${ele._id.toString()} up` },
            { text: "⬇️", callback_data: `/move_social ${ele._id.toString()} down` },
            { text: "❌", callback_data: `/delete_social ${ele._id.toString()}` },
        ]);

        keyboard.push([{ text: "➕ Add Site", callback_data: "/add_social_site" }]);
        keyboard.push([{ text: "↩️ Go Back", callback_data: "/admin" }]);

        return buildResponse(text, keyboard);
    } catch (error) {
        console.error("Error in get_social_sites :", error);
        await ctx.answerCbQuery("⚠️ Something went wrong !", { show_alert: true });
    }
};