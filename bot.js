const {
    Client,
    GatewayIntentBits,
    PermissionsBitField,
    REST,
    Routes,
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require("discord.js");

const { Pool } = require("pg");
const crypto = require("crypto");

// ======================================================
// CONFIG
// ======================================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const DATABASE_URL = process.env.DATABASE_URL;

const PREMIUM_ROLE_NAME = "Premium";

const LOADER_URL =
    "https://raw.githubusercontent.com/khanhdep41-tech/-NhatKhanh-Hub/refs/heads/main/Loader.lua";

const LOADER_CODE =
    'loadstring(game:HttpGet("https://raw.githubusercontent.com/khanhdep41-tech/-NhatKhanh-Hub/refs/heads/main/Loader.lua"))()';

const HWID_RESET_COOLDOWN = 12 * 60 * 60 * 1000;

if (!TOKEN) {
    console.error("[BOT] DISCORD_TOKEN is missing.");
    process.exit(1);
}

if (!CLIENT_ID) {
    console.error("[BOT] DISCORD_CLIENT_ID is missing.");
    process.exit(1);
}

if (!GUILD_ID) {
    console.error("[BOT] DISCORD_GUILD_ID is missing.");
    process.exit(1);
}

if (!DATABASE_URL) {
    console.error("[BOT] DATABASE_URL is missing.");
    process.exit(1);
}

// ======================================================
// DATABASE
// ======================================================

const pool = new Pool({
    connectionString: DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
});

// ======================================================
// DISCORD CLIENT
// ======================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

// ======================================================
// HELPERS
// ======================================================

function clean(value) {
    return typeof value === "string" ? value.trim() : "";
}

function formatDate(date) {
    if (!date) return "Không có";

    return new Intl.DateTimeFormat("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    }).format(new Date(date));
}

function formatRemaining(expiresAt) {
    if (!expiresAt) return "Không giới hạn";

    const diff = new Date(expiresAt).getTime() - Date.now();

    if (diff <= 0) {
        return "Đã hết hạn";
    }

    const totalSeconds = Math.floor(diff / 1000);

    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    const parts = [];

    if (days > 0) parts.push(`${days} ngày`);
    if (hours > 0) parts.push(`${hours} giờ`);
    if (minutes > 0) parts.push(`${minutes} phút`);

    return parts.join(" ") || "Dưới 1 phút";
}

function generateKey() {
    function part() {
        return crypto
            .randomBytes(3)
            .toString("hex")
            .toUpperCase()
            .slice(0, 5);
    }

    return `NKH-${part()}-${part()}-${part()}`;
}

function isActiveKey(row) {
    if (!row) return false;
    if (!row.active) return false;

    if (
        row.expires_at &&
        new Date(row.expires_at).getTime() <= Date.now()
    ) {
        return false;
    }

    return true;
}

// ======================================================
// PREMIUM ROLE
// ======================================================

async function getPremiumRole(guild) {
    await guild.roles.fetch();

    const role = guild.roles.cache.find(
        role => role.name === PREMIUM_ROLE_NAME
    );

    return role || null;
}

async function givePremiumRole(guild, userId) {
    const role = await getPremiumRole(guild);

    if (!role) {
        return {
            success: false,
            message: `Không tìm thấy role **${PREMIUM_ROLE_NAME}**.`
        };
    }

    const botMember = guild.members.me;

    if (!botMember) {
        return {
            success: false,
            message: "Không tìm thấy Bot Member."
        };
    }

    if (
        !botMember.permissions.has(
            PermissionsBitField.Flags.ManageRoles
        )
    ) {
        return {
            success: false,
            message: "Bot chưa có quyền **Manage Roles**."
        };
    }

    if (role.managed) {
        return {
            success: false,
            message: "Role Premium là managed role và không thể cấp thủ công."
        };
    }

    if (role.position >= botMember.roles.highest.position) {
        return {
            success: false,
            message:
                "Role **Premium** đang cao hơn hoặc ngang role Bot. Hãy kéo `NhatKhanh Hub` lên trên Premium."
        };
    }

    const member = await guild.members.fetch(userId);

    if (member.roles.cache.has(role.id)) {
        return {
            success: true,
            alreadyHadRole: true,
            role
        };
    }

    await member.roles.add(
        role,
        "NhatKhanh Hub Premium Key"
    );

    return {
        success: true,
        alreadyHadRole: false,
        role
    };
}

// ======================================================
// DATABASE INIT
// ======================================================

async function initDatabase() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS keys (
            key TEXT PRIMARY KEY,
            hwid TEXT,
            expires_at TIMESTAMPTZ,
            active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        ALTER TABLE keys
        ADD COLUMN IF NOT EXISTS discord_user_id TEXT
    `);

    await pool.query(`
        ALTER TABLE keys
        ADD COLUMN IF NOT EXISTS redeemed_at TIMESTAMPTZ
    `);

    await pool.query(`
        ALTER TABLE keys
        ADD COLUMN IF NOT EXISTS last_hwid_reset TIMESTAMPTZ
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_keys_discord_user_id
        ON keys(discord_user_id)
    `);

    console.log("[BOT] Database ready.");
}

// ======================================================
// COMMAND DEFINITIONS
// ======================================================

const commands = [

    new SlashCommandBuilder()
        .setName("panel")
        .setDescription("Mở bảng điều khiển NhatKhanh Hub"),

    new SlashCommandBuilder()
        .setName("setup")
        .setDescription("Kiểm tra cấu hình Premium Role"),

    new SlashCommandBuilder()
        .setName("createkey")
        .setDescription("Tạo key Premium 30 ngày")
        .setDefaultMemberPermissions(
            PermissionsBitField.Flags.Administrator
        ),

    new SlashCommandBuilder()
        .setName("disablekey")
        .setDescription("Vô hiệu hóa một key")
        .addStringOption(option =>
            option
                .setName("key")
                .setDescription("Key cần vô hiệu hóa")
                .setRequired(true)
        )
        .setDefaultMemberPermissions(
            PermissionsBitField.Flags.Administrator
        ),

    new SlashCommandBuilder()
        .setName("enablekey")
        .setDescription("Kích hoạt lại một key")
        .addStringOption(option =>
            option
                .setName("key")
                .setDescription("Key cần kích hoạt")
                .setRequired(true)
        )
        .setDefaultMemberPermissions(
            PermissionsBitField.Flags.Administrator
        ),

    new SlashCommandBuilder()
        .setName("resethwid")
        .setDescription("Admin reset HWID của một key")
        .addStringOption(option =>
            option
                .setName("key")
                .setDescription("Key cần reset HWID")
                .setRequired(true)
        )
        .setDefaultMemberPermissions(
            PermissionsBitField.Flags.Administrator
        ),

    new SlashCommandBuilder()
        .setName("keystats")
        .setDescription("Xem thông tin một key")
        .addStringOption(option =>
            option
                .setName("key")
                .setDescription("Key cần xem")
                .setRequired(true)
        )
        .setDefaultMemberPermissions(
            PermissionsBitField.Flags.Administrator
        )

].map(command => command.toJSON());

// ======================================================
// REGISTER SLASH COMMANDS
// ======================================================

async function registerCommands() {
    const rest = new REST({ version: "10" })
        .setToken(TOKEN);

    console.log("[BOT] Registering slash commands...");

    await rest.put(
        Routes.applicationGuildCommands(
            CLIENT_ID,
            GUILD_ID
        ),
        {
            body: commands
        }
    );

    console.log("[BOT] Slash commands registered.");
}

// ======================================================
// PANEL
// ======================================================

function createPanel() {
    const embed = new EmbedBuilder()
        .setTitle("🔐 NhatKhanh Hub")
        .setDescription(
            [
                "Hệ thống quản lý Key Premium",
                "",
                "🔵 **Redeem Key**",
                "Nhập Key để kích hoạt Premium.",
                "",
                "🟢 **Get Role**",
                "Nhận lại role Premium.",
                "",
                "⚫ **Get Script**",
                "Lấy Loader của NhatKhanh Hub.",
                "",
                "⚫ **Get Stats**",
                "Xem Key, HWID và thời gian còn lại.",
                "",
                "🔴 **Reset HWID**",
                "Reset HWID với cooldown 12 giờ."
            ].join("\n")
        )
        .setFooter({
            text: "NhatKhanh Hub"
        });

    const row1 = new ActionRowBuilder().addComponents(

        new ButtonBuilder()
            .setCustomId("redeem_key")
            .setLabel("Redeem Key")
            .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
            .setCustomId("get_role")
            .setLabel("Get Role")
            .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
            .setCustomId("get_script")
            .setLabel("Get Script")
            .setStyle(ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(

        new ButtonBuilder()
            .setCustomId("get_stats")
            .setLabel("Get Stats")
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId("reset_hwid")
            .setLabel("Reset HWID")
            .setStyle(ButtonStyle.Danger)
    );

    return {
        embeds: [embed],
        components: [row1, row2]
    };
}

// ======================================================
// USER KEY
// ======================================================

async function getUserKey(userId) {
    const result = await pool.query(
        `
        SELECT
            key,
            hwid,
            expires_at,
            active,
            created_at,
            discord_user_id,
            redeemed_at,
            last_hwid_reset
        FROM keys
        WHERE discord_user_id = $1
        ORDER BY redeemed_at DESC NULLS LAST
        LIMIT 1
        `,
        [userId]
    );

    return result.rows[0] || null;
}

// ======================================================
// REDEEM KEY
// ======================================================

async function redeemKey(userId, inputKey) {
    const key = clean(inputKey);

    if (!key) {
        return {
            success: false,
            message: "Bạn chưa nhập Key."
        };
    }

    const clientDB = await pool.connect();

    try {
        await clientDB.query("BEGIN");

        const existingUserKey = await clientDB.query(
            `
            SELECT
                key,
                expires_at,
                active
            FROM keys
            WHERE discord_user_id = $1
              AND active = TRUE
              AND (
                    expires_at IS NULL
                    OR expires_at > NOW()
              )
            LIMIT 1
            FOR UPDATE
            `,
            [userId]
        );

        if (existingUserKey.rows.length > 0) {
            await clientDB.query("ROLLBACK");

            return {
                success: false,
                message:
                    "Bạn đã có một Key Premium đang hoạt động."
            };
        }

        const keyResult = await clientDB.query(
            `
            SELECT
                key,
                hwid,
                expires_at,
                active,
                discord_user_id,
                redeemed_at
            FROM keys
            WHERE key = $1
            LIMIT 1
            FOR UPDATE
            `,
            [key]
        );

        if (keyResult.rows.length === 0) {
            await clientDB.query("ROLLBACK");

            return {
                success: false,
                message: "Key không tồn tại."
            };
        }

        const keyData = keyResult.rows[0];

        if (!keyData.active) {
            await clientDB.query("ROLLBACK");

            return {
                success: false,
                message: "Key này đã bị vô hiệu hóa."
            };
        }

        if (
            keyData.expires_at &&
            new Date(keyData.expires_at).getTime() <= Date.now()
        ) {
            await clientDB.query("ROLLBACK");

            return {
                success: false,
                message: "Key này đã hết hạn."
            };
        }

        if (keyData.discord_user_id) {

            if (keyData.discord_user_id === userId) {
                await clientDB.query("COMMIT");

                return {
                    success: true,
                    alreadyRedeemed: true,
                    keyData
                };
            }

            await clientDB.query("ROLLBACK");

            return {
                success: false,
                message: "Key này đã được Redeem bởi tài khoản Discord khác."
            };
        }

        const updateResult = await clientDB.query(
            `
            UPDATE keys
            SET
                discord_user_id = $1,
                redeemed_at = NOW()
            WHERE key = $2
              AND discord_user_id IS NULL
            RETURNING
                key,
                hwid,
                expires_at,
                active,
                discord_user_id,
                redeemed_at
            `,
            [userId, key]
        );

        if (updateResult.rowCount === 0) {
            await clientDB.query("ROLLBACK");

            return {
                success: false,
                message: "Key vừa được sử dụng bởi tài khoản khác."
            };
        }

        await clientDB.query("COMMIT");

        return {
            success: true,
            alreadyRedeemed: false,
            keyData: updateResult.rows[0]
        };

    } catch (error) {
        try {
            await clientDB.query("ROLLBACK");
        } catch {}

        throw error;

    } finally {
        clientDB.release();
    }
}

// ======================================================
// STATS EMBED
// ======================================================

function createStatsEmbed(keyData) {
    if (!keyData) {
        return new EmbedBuilder()
            .setTitle("📊 Key Stats")
            .setDescription(
                "Bạn chưa Redeem Key."
            );
    }

    const active = isActiveKey(keyData);

    const hwidText = keyData.hwid
        ? `\`${keyData.hwid}\``
        : "`Chưa bind`";

    let nextReset = "Có thể Reset ngay.";

    if (keyData.last_hwid_reset) {
        const next =
            new Date(keyData.last_hwid_reset).getTime() +
            HWID_RESET_COOLDOWN;

        const remaining = next - Date.now();

        if (remaining > 0) {
            const hours = Math.floor(
                remaining / (60 * 60 * 1000)
            );

            const minutes = Math.floor(
                (remaining % (60 * 60 * 1000)) /
                (60 * 1000)
            );

            nextReset =
                `Còn ${hours} giờ ${minutes} phút`;
        }
    }

    return new EmbedBuilder()
        .setTitle("📊 NhatKhanh Hub - Key Stats")
        .addFields(

            {
                name: "🔑 Key",
                value: `\`${keyData.key}\``,
                inline: false
            },

            {
                name: "📌 Status",
                value: active
                    ? "🟢 Active"
                    : "🔴 Inactive / Expired",
                inline: true
            },

            {
                name: "⏳ Expiry",
                value: formatDate(keyData.expires_at),
                inline: true
            },

            {
                name: "⌛ Còn lại",
                value: formatRemaining(keyData.expires_at),
                inline: true
            },

            {
                name: "💻 HWID",
                value: hwidText,
                inline: false
            },

            {
                name: "🔄 Last HWID Reset",
                value: formatDate(keyData.last_hwid_reset),
                inline: true
            },

            {
                name: "⏱️ Next Reset",
                value: nextReset,
                inline: true
            },

            {
                name: "📅 Redeemed",
                value: formatDate(keyData.redeemed_at),
                inline: true
            }
        )
        .setFooter({
            text: "NhatKhanh Hub"
        });
}

// ======================================================
// INTERACTION HANDLER
// ======================================================

client.on("interactionCreate", async interaction => {

    try {

        // ==================================================
        // SLASH COMMANDS
        // ==================================================

        if (interaction.isChatInputCommand()) {

            // ----------------------------------------------
            // /panel
            // ----------------------------------------------

            if (interaction.commandName === "panel") {

                return interaction.reply({
                    ...createPanel()
                });
            }

            // ----------------------------------------------
            // /setup
            // ----------------------------------------------

            if (interaction.commandName === "setup") {

                if (
                    !interaction.memberPermissions?.has(
                        PermissionsBitField.Flags.Administrator
                    )
                ) {
                    return interaction.reply({
                        content: "❌ Bạn cần quyền Administrator.",
                        ephemeral: true
                    });
                }

                const guild = interaction.guild;

                const role =
                    await getPremiumRole(guild);

                if (!role) {
                    return interaction.reply({
                        content:
                            "❌ Không tìm thấy role `Premium`.",
                        ephemeral: true
                    });
                }

                const botMember = guild.members.me;

                if (!botMember) {
                    return interaction.reply({
                        content:
                            "❌ Không tìm thấy Bot Member.",
                        ephemeral: true
                    });
                }

                const canManage =
                    botMember.permissions.has(
                        PermissionsBitField.Flags.ManageRoles
                    );

                const hierarchyOK =
                    role.position <
                    botMember.roles.highest.position;

                const embed =
                    new EmbedBuilder()
                        .setTitle("⚙️ NhatKhanh Hub Setup")
                        .addFields(
                            {
                                name: "Premium Role",
                                value:
                                    `✅ ${role.name}\nID: \`${role.id}\``
                            },
                            {
                                name: "Manage Roles",
                                value:
                                    canManage
                                        ? "✅ Có"
                                        : "❌ Không"
                            },
                            {
                                name: "Role Hierarchy",
                                value:
                                    hierarchyOK
                                        ? "✅ Bot có thể cấp Premium"
                                        : "❌ Bot role phải nằm trên Premium"
                            }
                        );

                return interaction.reply({
                    embeds: [embed],
                    ephemeral: true
                });
            }

            // ----------------------------------------------
            // /createkey
            // ----------------------------------------------

            if (interaction.commandName === "createkey") {

                const key = generateKey();

                const result = await pool.query(
                    `
                    INSERT INTO keys
                        (
                            key,
                            hwid,
                            expires_at,
                            active
                        )
                    VALUES
                        (
                            $1,
                            NULL,
                            NOW() + INTERVAL '30 days',
                            TRUE
                        )
                    RETURNING
                        key,
                        expires_at
                    `,
                    [key]
                );

                const created =
                    result.rows[0];

                const embed =
                    new EmbedBuilder()
                        .setTitle("🔑 Key Created")
                        .addFields(
                            {
                                name: "Key",
                                value:
                                    `\`${created.key}\``
                            },
                            {
                                name: "Thời hạn",
                                value:
                                    "30 ngày"
                            },
                            {
                                name: "Expiry",
                                value:
                                    formatDate(
                                        created.expires_at
                                    )
                            }
                        );

                return interaction.reply({
                    embeds: [embed],
                    ephemeral: true
                });
            }

            // ----------------------------------------------
            // /disablekey
            // ----------------------------------------------

            if (interaction.commandName === "disablekey") {

                const key =
                    clean(
                        interaction.options.getString(
                            "key"
                        )
                    );

                const result = await pool.query(
                    `
                    UPDATE keys
                    SET active = FALSE
                    WHERE key = $1
                    RETURNING key
                    `,
                    [key]
                );

                if (result.rowCount === 0) {
                    return interaction.reply({
                        content:
                            "❌ Không tìm thấy Key.",
                        ephemeral: true
                    });
                }

                return interaction.reply({
                    content:
                        `🔴 Đã disable Key \`${key}\`.`,
                    ephemeral: true
                });
            }

            // ----------------------------------------------
            // /enablekey
            // ----------------------------------------------

            if (interaction.commandName === "enablekey") {

                const key =
                    clean(
                        interaction.options.getString(
                            "key"
                        )
                    );

                const result = await pool.query(
                    `
                    UPDATE keys
                    SET active = TRUE
                    WHERE key = $1
                    RETURNING key, expires_at
                    `,
                    [key]
                );

                if (result.rowCount === 0) {
                    return interaction.reply({
                        content:
                            "❌ Không tìm thấy Key.",
                        ephemeral: true
                    });
                }

                const row =
                    result.rows[0];

                return interaction.reply({
                    content:
                        `🟢 Đã enable Key \`${row.key}\`.\n` +
                        `Expiry: ${formatDate(row.expires_at)}`,
                    ephemeral: true
                });
            }

            // ----------------------------------------------
            // /resethwid
            // ----------------------------------------------

            if (interaction.commandName === "resethwid") {

                const key =
                    clean(
                        interaction.options.getString(
                            "key"
                        )
                    );

                const result = await pool.query(
                    `
                    UPDATE keys
                    SET
                        hwid = NULL,
                        last_hwid_reset = NOW()
                    WHERE key = $1
                    RETURNING key
                    `,
                    [key]
                );

                if (result.rowCount === 0) {
                    return interaction.reply({
                        content:
                            "❌ Không tìm thấy Key.",
                        ephemeral: true
                    });
                }

                return interaction.reply({
                    content:
                        `🔄 Đã reset HWID cho \`${key}\`.`,
                    ephemeral: true
                });
            }

            // ----------------------------------------------
            // /keystats
            // ----------------------------------------------

            if (interaction.commandName === "keystats") {

                const key =
                    clean(
                        interaction.options.getString(
                            "key"
                        )
                    );

                const result = await pool.query(
                    `
                    SELECT
                        key,
                        hwid,
                        expires_at,
                        active,
                        created_at,
                        discord_user_id,
                        redeemed_at,
                        last_hwid_reset
                    FROM keys
                    WHERE key = $1
                    LIMIT 1
                    `,
                    [key]
                );

                if (result.rows.length === 0) {
                    return interaction.reply({
                        content:
                            "❌ Không tìm thấy Key.",
                        ephemeral: true
                    });
                }

                return interaction.reply({
                    embeds: [
                        createStatsEmbed(
                            result.rows[0]
                        )
                    ],
                    ephemeral: true
                });
            }
        }

        // ==================================================
        // BUTTONS
        // ==================================================

        if (interaction.isButton()) {

            // ----------------------------------------------
            // REDEEM
            // ----------------------------------------------

            if (
                interaction.customId ===
                "redeem_key"
            ) {

                const modal =
                    new ModalBuilder()
                        .setCustomId(
                            "redeem_key_modal"
                        )
                        .setTitle(
                            "Redeem NhatKhanh Key"
                        );

                const keyInput =
                    new TextInputBuilder()
                        .setCustomId("key")
                        .setLabel("Nhập Key")
                        .setPlaceholder(
                            "NKH-XXXXX-XXXXX-XXXXX"
                        )
                        .setStyle(
                            TextInputStyle.Short
                        )
                        .setRequired(true)
                        .setMaxLength(50);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        keyInput
                    )
                );

                return interaction.showModal(modal);
            }

            // ----------------------------------------------
            // GET ROLE
            // ----------------------------------------------

            if (
                interaction.customId ===
                "get_role"
            ) {

                const keyData =
                    await getUserKey(
                        interaction.user.id
                    );

                if (!keyData) {
                    return interaction.reply({
                        content:
                            "❌ Bạn chưa Redeem Key.",
                        ephemeral: true
                    });
                }

                if (!isActiveKey(keyData)) {
                    return interaction.reply({
                        content:
                            "❌ Key của bạn đã hết hạn hoặc bị vô hiệu hóa.",
                        ephemeral: true
                    });
                }

                const result =
                    await givePremiumRole(
                        interaction.guild,
                        interaction.user.id
                    );

                if (!result.success) {
                    return interaction.reply({
                        content:
                            `❌ ${result.message}`,
                        ephemeral: true
                    });
                }

                return interaction.reply({
                    content:
                        result.alreadyHadRole
                            ? "✅ Bạn đã có role Premium."
                            : "🟢 Đã cấp role **Premium** cho bạn.",
                    ephemeral: true
                });
            }

            // ----------------------------------------------
            // GET SCRIPT
            // ----------------------------------------------

            if (
                interaction.customId ===
                "get_script"
            ) {

                const keyData =
                    await getUserKey(
                        interaction.user.id
                    );

                if (!keyData) {
                    return interaction.reply({
                        content:
                            "❌ Bạn chưa Redeem Key.",
                        ephemeral: true
                    });
                }

                if (!isActiveKey(keyData)) {
                    return interaction.reply({
                        content:
                            "❌ Key của bạn đã hết hạn hoặc bị vô hiệu hóa.",
                        ephemeral: true
                    });
                }

                await interaction.reply({
                    content:
                        "⏳ **Loading...**",
                    ephemeral: true
                });

                await new Promise(
                    resolve =>
                        setTimeout(
                            resolve,
                            1200
                        )
                );

                const copyButton =
                    new ButtonBuilder()
                        .setCustomId(
                            "copy_loader"
                        )
                        .setLabel(
                            "Copy"
                        )
                        .setStyle(
                            ButtonStyle.Primary
                        );

                const row =
                    new ActionRowBuilder()
                        .addComponents(
                            copyButton
                        );

                return interaction.editReply({
                    content:
                        [
                            "✅ **Loader đã sẵn sàng!**",
                            "",
                            `🔗 ${LOADER_URL}`,
                            "",
                            "```lua",
                            LOADER_CODE,
                            "```",
                            "",
                            "Bấm **Copy** để hiện code và copy thủ công."
                        ].join("\n"),
                    components: [row]
                });
            }

            // ----------------------------------------------
            // COPY
            // ----------------------------------------------

            if (
                interaction.customId ===
                "copy_loader"
            ) {

                return interaction.reply({
                    content:
                        [
                            "📋 **Copy Loader:**",
                            "",
                            "```lua",
                            LOADER_CODE,
                            "```"
                        ].join("\n"),
                    ephemeral: true
                });
            }

            // ----------------------------------------------
            // STATS
            // ----------------------------------------------

            if (
                interaction.customId ===
                "get_stats"
            ) {

                const keyData =
                    await getUserKey(
                        interaction.user.id
                    );

                if (!keyData) {
                    return interaction.reply({
                        content:
                            "❌ Bạn chưa Redeem Key.",
                        ephemeral: true
                    });
                }

                return interaction.reply({
                    embeds: [
                        createStatsEmbed(
                            keyData
                        )
                    ],
                    ephemeral: true
                });
            }

            // ----------------------------------------------
            // RESET HWID
            // ----------------------------------------------

            if (
                interaction.customId ===
                "reset_hwid"
            ) {

                const keyData =
                    await getUserKey(
                        interaction.user.id
                    );

                if (!keyData) {
                    return interaction.reply({
                        content:
                            "❌ Bạn chưa Redeem Key.",
                        ephemeral: true
                    });
                }

                if (!isActiveKey(keyData)) {
                    return interaction.reply({
                        content:
                            "❌ Key của bạn đã hết hạn hoặc bị vô hiệu hóa.",
                        ephemeral: true
                    });
                }

                if (keyData.last_hwid_reset) {

                    const nextReset =
                        new Date(
                            keyData.last_hwid_reset
                        ).getTime() +
                        HWID_RESET_COOLDOWN;

                    const remaining =
                        nextReset -
                        Date.now();

                    if (remaining > 0) {

                        const hours =
                            Math.floor(
                                remaining /
                                (60 * 60 * 1000)
                            );

                        const minutes =
                            Math.floor(
                                (
                                    remaining %
                                    (60 * 60 * 1000)
                                ) /
                                (60 * 1000)
                            );

                        return interaction.reply({
                            content:
                                `⏳ Bạn chưa thể Reset HWID.\n` +
                                `Còn **${hours} giờ ${minutes} phút**.`,
                            ephemeral: true
                        });
                    }
                }

                await pool.query(
                    `
                    UPDATE keys
                    SET
                        hwid = NULL,
                        last_hwid_reset = NOW()
                    WHERE key = $1
                      AND discord_user_id = $2
                    `,
                    [
                        keyData.key,
                        interaction.user.id
                    ]
                );

                return interaction.reply({
                    content:
                        [
                            "🔄 **Reset HWID thành công!**",
                            "",
                            "HWID hiện tại đã được xóa.",
                            "Lần verify tiếp theo sẽ bind HWID mới.",
                            "",
                            "⏱️ Cooldown: **12 giờ**."
                        ].join("\n"),
                    ephemeral: true
                });
            }
        }

        // ==================================================
        // MODAL
        // ==================================================

        if (
            interaction.isModalSubmit() &&
            interaction.customId ===
                "redeem_key_modal"
        ) {

            const key =
                clean(
                    interaction.fields.getTextInputValue(
                        "key"
                    )
                );

            await interaction.deferReply({
                ephemeral: true
            });

            const result =
                await redeemKey(
                    interaction.user.id,
                    key
                );

            if (!result.success) {
                return interaction.editReply({
                    content:
                        `❌ ${result.message}`
                });
            }

            const roleResult =
                await givePremiumRole(
                    interaction.guild,
                    interaction.user.id
                );

            if (!roleResult.success) {

                return interaction.editReply({
                    content:
                        [
                            "✅ Key đã Redeem thành công.",
                            "",
                            `🔑 Key: \`${result.keyData.key}\``,
                            `⏳ Expiry: ${formatDate(result.keyData.expires_at)}`,
                            "",
                            `⚠️ Nhưng chưa cấp được Premium Role:`,
                            roleResult.message
                        ].join("\n")
                });
            }

            return interaction.editReply({
                content:
                    [
                        "🎉 **Redeem thành công!**",
                        "",
                        `🔑 Key: \`${result.keyData.key}\``,
                        `⏳ Expiry: ${formatDate(result.keyData.expires_at)}`,
                        "",
                        "🟢 Premium Role đã được cấp.",
                        "",
                        "Bạn có thể dùng:",
                        "• Get Script",
                        "• Get Stats",
                        "• Reset HWID"
                    ].join("\n")
            });
        }

    } catch (error) {

        console.error(
            "[BOT] Interaction error:",
            error
        );

        if (interaction.replied) {

            await interaction.followUp({
                content:
                    "❌ Đã xảy ra lỗi. Kiểm tra Render Logs.",
                ephemeral: true
            }).catch(() => {});

        } else if (interaction.deferred) {

            await interaction.editReply({
                content:
                    "❌ Đã xảy ra lỗi. Kiểm tra Render Logs."
            }).catch(() => {});

        } else {

            await interaction.reply({
                content:
                    "❌ Đã xảy ra lỗi. Kiểm tra Render Logs.",
                ephemeral: true
            }).catch(() => {});
        }
    }
});

// ======================================================
// READY
// ======================================================

client.once("ready", async readyClient => {

    console.log(
        `[BOT] Logged in as ${readyClient.user.tag}`
    );

    try {

        const guild =
            await readyClient.guilds.fetch(
                GUILD_ID
            );

        console.log(
            `[BOT] Connected to server: ${guild.name}`
        );

        const role =
            await getPremiumRole(guild);

        if (role) {
            console.log(
                `[BOT] Premium role found: ${role.name} (${role.id})`
            );
        } else {
            console.log(
                "[BOT] WARNING: Premium role not found."
            );
        }

        await registerCommands();

    } catch (error) {

        console.error(
            "[BOT] Ready setup error:",
            error
        );
    }
});

// ======================================================
// START
// ======================================================

async function start() {

    try {

        await initDatabase();

        await client.login(TOKEN);

    } catch (error) {

        console.error(
            "[BOT] Startup error:",
            error
        );

        process.exit(1);
    }
}

start();
