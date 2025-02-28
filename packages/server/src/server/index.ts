/* eslint-disable class-methods-use-this */
// Dependency Imports
import { app, BrowserWindow, nativeTheme, systemPreferences, dialog } from "electron";
import fs from "fs";
import ServerLog from "electron-log";
import process from "process";
import path from "path";
import os from "os";
import { EventEmitter } from "events";
import macosVersion from "macos-version";
import { getAuthStatus } from "node-mac-permissions";

// Configuration/Filesytem Imports
import { FileSystem } from "@server/fileSystem";

// Database Imports
import { ServerRepository, ServerConfigChange } from "@server/databases/server";
import { MessageRepository } from "@server/databases/imessage";
import { FindMyRepository } from "@server/databases/findmy";
import {
    IncomingMessageListener,
    OutgoingMessageListener,
    GroupChangeListener
} from "@server/databases/imessage/listeners";
import { Message } from "@server/databases/imessage/entity/Message";
import { MessageChangeListener } from "@server/databases/imessage/listeners/messageChangeListener";

// Service Imports
import {
    HttpService,
    FCMService,
    CaffeinateService,
    NgrokService,
    LocalTunnelService,
    NetworkService,
    QueueService,
    IPCService,
    UpdateService,
    CloudflareService,
    WebhookService,
    FacetimeService,
    ScheduledMessagesService
} from "@server/services";
import { EventCache } from "@server/eventCache";
import { runTerminalScript, openSystemPreferences } from "@server/api/v1/apple/scripts";

import { ActionHandler } from "./api/v1/apple/actions";
import {
    insertChatParticipants,
    isEmpty,
    isMinBigSur,
    isMinMojave,
    isMinMonterey,
    isMinSierra,
    isNotEmpty
} from "./helpers/utils";
import { Proxy } from "./services/proxyServices/proxy";
import { BlueBubblesHelperService } from "./services/privateApi";
import { OutgoingMessageManager } from "./managers/outgoingMessageManager";
import { requestContactPermission } from "./utils/PermissionUtils";
import { AlertsInterface } from "./api/v1/interfaces/alertsInterface";
import { MessageSerializer } from "./api/v1/serializers/MessageSerializer";
import {
    GROUP_NAME_CHANGE,
    MESSAGE_UPDATED,
    NEW_MESSAGE,
    NEW_SERVER,
    PARTICIPANT_ADDED,
    PARTICIPANT_LEFT,
    PARTICIPANT_REMOVED
} from "./events";

const findProcess = require("find-process");

const osVersion = macosVersion();

const facetimeServiceEnabled = true;

// Set the log format
const logFormat = "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}";
ServerLog.transports.console.format = logFormat;
ServerLog.transports.file.format = logFormat;

// Patch in the original package path so we don't use @bluebubbles/server
ServerLog.transports.file.resolvePath = () =>
    path.join(os.homedir(), "Library", "Logs", "bluebubbles-server", "main.log");

/**
 * Create a singleton for the server so that it can be referenced everywhere.
 * Plus, we only want one instance of it running at all times.
 */
let server: BlueBubblesServer = null;
export const Server = (win: BrowserWindow = null) => {
    // If we already have a server, update the window (if not null) and return
    // the same instance
    if (server) {
        if (win) server.window = win;
        return server;
    }

    server = new BlueBubblesServer(win);
    return server;
};

/**
 * Main entry point for the back-end server
 * This will handle all services and helpers that get spun
 * up when running the application.
 */
class BlueBubblesServer extends EventEmitter {
    window: BrowserWindow;

    repo: ServerRepository;

    iMessageRepo: MessageRepository;

    findMyRepo: FindMyRepository;

    httpService: HttpService;

    privateApiHelper: BlueBubblesHelperService;

    fcm: FCMService;

    facetime: FacetimeService;

    networkChecker: NetworkService;

    caffeinate: CaffeinateService;

    updater: UpdateService;

    scheduledMessages: ScheduledMessagesService;

    messageManager: OutgoingMessageManager;

    queue: QueueService;

    proxyServices: Proxy[];

    webhookService: WebhookService;

    actionHandler: ActionHandler;

    chatListeners: MessageChangeListener[];

    eventCache: EventCache;

    hasSetup: boolean;

    hasStarted: boolean;

    notificationCount: number;

    isRestarting: boolean;

    isStopping: boolean;

    lastConnection: number;

    region: string | null;

    get hasDiskAccess(): boolean {
        // As long as we've tried to initialize the DB, we know if we do/do not have access.
        const dbInit: boolean | null = this.iMessageRepo?.db?.isInitialized;
        if (dbInit != null) return dbInit;

        // If we've never initialized the DB, and just want to detect if we have access,
        // we can check the permissions using node-mac-permissions. However, default to true,
        // if the macOS version is under Mojave.
        let status = true;
        if (isMinMojave) {
            const authStatus = getAuthStatus("full-disk-access");
            if (authStatus === "authorized") {
                status = true;
            } else {
                this.log(`FullDiskAccess Permission Status: ${authStatus}`, "debug");
            }
        }

        return status;
    }

    get hasAccessibilityAccess(): boolean {
        return systemPreferences.isTrustedAccessibilityClient(false) === true;
    }

    /**
     * Constructor to just initialize everything to null pretty much
     *
     * @param window The browser window associated with the Electron app
     */
    constructor(window: BrowserWindow) {
        super();

        this.window = window;

        // Databases
        this.repo = null;
        this.iMessageRepo = null;
        this.findMyRepo = null;

        // Other helpers
        this.eventCache = null;
        this.chatListeners = [];
        this.actionHandler = null;

        // Services
        this.httpService = null;
        this.privateApiHelper = null;
        this.fcm = null;
        this.facetime = null;
        this.caffeinate = null;
        this.networkChecker = null;
        this.queue = null;
        this.proxyServices = [];
        this.updater = null;
        this.messageManager = null;
        this.webhookService = null;
        this.scheduledMessages = null;

        this.hasSetup = false;
        this.hasStarted = false;
        this.notificationCount = 0;
        this.isRestarting = false;
        this.isStopping = false;

        this.region = null;
    }

    emitToUI(event: string, data: any) {
        try {
            if (this.window) this.window.webContents.send(event, data);
        } catch {
            /* Ignore errors here */
        }
    }

    /**
     * Handler for sending logs. This allows us to also route
     * the logs to the main Electron window
     *
     * @param message The message to print
     * @param type The log type
     */
    log(message: any, type?: "log" | "error" | "warn" | "debug") {
        switch (type) {
            case "error":
                ServerLog.error(message);
                AlertsInterface.create("error", message);
                this.notificationCount += 1;
                break;
            case "debug":
                ServerLog.debug(message);
                break;
            case "warn":
                ServerLog.warn(message);
                AlertsInterface.create("warn", message);
                this.notificationCount += 1;
                break;
            case "log":
            default:
                ServerLog.log(message);
        }

        if (["error", "warn"].includes(type)) {
            this.setNotificationCount(this.notificationCount);
        }

        this.emitToUI("new-log", {
            message,
            type: type ?? "log"
        });
    }

    setNotificationCount(count: number) {
        this.notificationCount = count;

        if (this.repo.getConfig("dock_badge")) {
            app.setBadgeCount(this.notificationCount);
        }
    }

    async initServer(): Promise<void> {
        // If we've already started up, don't do anything
        if (this.hasStarted) return;

        this.log("Performing initial setup...");

        // Get the current macOS theme
        this.getTheme();

        // Initialize and connect to the server database
        await this.initDatabase();

        this.log("Starting IPC Listeners..");
        IPCService.startIpcListeners();

        // Do some pre-flight checks
        // Make sure settings are correct and all things are a go
        await this.preChecks();

        if (!this.isRestarting) {
            await this.initServerComponents();
        }
    }

    async initDatabase(): Promise<void> {
        this.log("Initializing server database...");
        this.repo = new ServerRepository();
        await this.repo.initialize();

        // Handle when something in the config changes
        this.repo.on("config-update", (args: ServerConfigChange) => this.handleConfigUpdate(args));

        try {
            this.log("Connecting to iMessage database...");
            this.iMessageRepo = new MessageRepository();
            await this.iMessageRepo.initialize();
        } catch (ex: any) {
            this.log(ex, "error");

            const dialogOpts = {
                type: "error",
                buttons: ["Restart", "Open System Preferences", "Ignore"],
                title: "BlueBubbles Error",
                message: "Full-Disk Access Permission Required!",
                detail:
                    `In order to function correctly, BlueBubbles requires full-disk access. ` +
                    `Please enable Full-Disk Access in System Preferences > Security & Privacy.`
            };

            dialog.showMessageBox(this.window, dialogOpts).then(returnValue => {
                if (returnValue.response === 0) {
                    this.relaunch();
                } else if (returnValue.response === 1) {
                    FileSystem.executeAppleScript(openSystemPreferences());
                    app.quit();
                }
            });
        }

        this.log("Initializing FindMy Repository...");
        this.findMyRepo = new FindMyRepository();
    }

    async initServices(): Promise<void> {
        try {
            this.log("Initializing connection to Google FCM...");
            this.fcm = new FCMService();
        } catch (ex: any) {
            this.log(`Failed to setup Google FCM service! ${ex.message}`, "error");
        }

        try {
            this.log("Initializing up sockets...");
            this.httpService = new HttpService();
        } catch (ex: any) {
            this.log(`Failed to setup socket service! ${ex.message}`, "error");
        }

        const privateApiEnabled = this.repo.getConfig("enable_private_api") as boolean;
        if (privateApiEnabled) {
            try {
                this.log("Initializing helper service...");
                this.privateApiHelper = new BlueBubblesHelperService();
            } catch (ex: any) {
                this.log(`Failed to setup helper service! ${ex.message}`, "error");
            }
        }

        try {
            this.log("Initializing proxy services...");
            this.proxyServices = [new NgrokService(), new LocalTunnelService(), new CloudflareService()];
        } catch (ex: any) {
            this.log(`Failed to initialize proxy services! ${ex.message}`, "error");
        }

        try {
            this.log("Initializing Message Manager...");
            this.messageManager = new OutgoingMessageManager();
        } catch (ex: any) {
            this.log(`Failed to start Message Manager service! ${ex.message}`, "error");
        }

        try {
            this.log("Initializing Webhook Service...");
            this.webhookService = new WebhookService();
        } catch (ex: any) {
            this.log(`Failed to start Webhook service! ${ex.message}`, "error");
        }

        try {
            this.log("Initializing Facetime service...");
            this.facetime = new FacetimeService();
        } catch (ex: any) {
            this.log(`Failed to start Facetime service! ${ex.message}`, "error");
        }

        try {
            this.log("Initializing Scheduled Messages Service...");
            this.scheduledMessages = new ScheduledMessagesService();
        } catch (ex: any) {
            this.log(`Failed to start Scheduled Message service! ${ex.message}`, "error");
        }
    }

    /**
     * Helper method for starting the message services
     *
     */
    async startServices(): Promise<void> {
        try {
            this.log("Starting HTTP service...");
            this.httpService.initialize();
            this.httpService.start();
        } catch (ex: any) {
            this.log(`Failed to start HTTP service! ${ex.message}`, "error");
        }

        try {
            await this.startProxyServices();
        } catch (ex: any) {
            this.log(`Failed to connect to Ngrok! ${ex.message}`, "error");
        }

        try {
            this.log("Starting FCM service...");
            await this.fcm.start();
        } catch (ex: any) {
            this.log(`Failed to start FCM service! ${ex.message}`, "error");
        }

        try {
            this.log("Starting Scheduled Messages service...");
            await this.scheduledMessages.start();
        } catch (ex: any) {
            this.log(`Failed to start Scheduled Messages service! ${ex.message}`, "error");
        }

        try {
            if (facetimeServiceEnabled) {
                this.startFacetimeListener();
            }
        } catch (ex: any) {
            this.log(`Failed to start Facetime service! ${ex.message}`, "error");
        }

        const privateApiEnabled = this.repo.getConfig("enable_private_api") as boolean;
        if (privateApiEnabled) {
            this.log("Starting Private API Helper listener...");
            this.privateApiHelper.start();
        }

        if (this.hasDiskAccess && isEmpty(this.chatListeners)) {
            this.log("Starting iMessage Database listeners...");
            this.startChatListeners();
        }
    }

    startFacetimeListener() {
        this.log("Starting Facetime service...");
        this.facetime.listen().catch(ex => {
            if (ex.message.includes("assistive access")) {
                this.log(
                    "Failed to start Facetime service! Please enable Accessibility permissions " +
                        "for BlueBubbles in System Preferences > Security & Privacy > Privacy > Accessibility",
                    "error"
                );
            } else {
                this.log(`Failed to start Facetime service! ${ex.message}`, "error");
            }
        });
    }

    async stopServices(): Promise<void> {
        this.isStopping = true;
        this.log("Stopping services...");

        try {
            FCMService.stop();
        } catch (ex: any) {
            this.log(`Failed to stop FCM service! ${ex?.message ?? ex}`);
        }

        try {
            this.removeChatListeners();
            this.removeAllListeners();
        } catch (ex: any) {
            this.log(`Failed to stop iMessage database listeners! ${ex?.message ?? ex}`);
        }

        try {
            await this.privateApiHelper?.stop();
        } catch (ex: any) {
            this.log(`Failed to stop Private API Helper service! ${ex?.message ?? ex}`);
        }

        try {
            await this.stopProxyServices();
        } catch (ex: any) {
            this.log(`Failed to stop Proxy services! ${ex?.message ?? ex}`);
        }

        try {
            await this.httpService?.stop();
        } catch (ex: any) {
            this.log(`Failed to stop HTTP service! ${ex?.message ?? ex}`, "error");
        }

        try {
            this.facetime?.stop();
        } catch (ex: any) {
            this.log(`Failed to stop Facetime service! ${ex?.message ?? ex}`, "error");
        }

        try {
            this.scheduledMessages?.stop();
        } catch (ex: any) {
            this.log(`Failed to stop Scheduled Messages service! ${ex?.message ?? ex}`, "error");
        }

        this.log("Finished stopping services...");
    }

    async stopServerComponents() {
        this.isStopping = true;
        this.log("Stopping all server components...");

        try {
            if (this.networkChecker) this.networkChecker.stop();
        } catch (ex: any) {
            this.log(`Failed to stop Network Checker service! ${ex?.message ?? ex}`);
        }

        try {
            if (this.caffeinate) this.caffeinate.stop();
        } catch (ex: any) {
            this.log(`Failed to stop Caffeinate service! ${ex?.message ?? ex}`);
        }

        try {
            await this.iMessageRepo?.db?.destroy();
        } catch (ex: any) {
            this.log(`Failed to close iMessage Database connection! ${ex?.message ?? ex}`);
        }

        try {
            if (this.repo?.db?.isInitialized) {
                await this.repo?.db?.destroy();
            }
        } catch (ex: any) {
            this.log(`Failed to close Server Database connection! ${ex?.message ?? ex}`);
        }

        this.log("Finished stopping all server components...");
    }

    /**
     * Officially starts the server. First, runs the setup,
     * then starts all of the services required for the server
     */
    async start(): Promise<void> {
        // Initialize server components (i.e. database, caches, listeners, etc.)
        await this.initServer();
        if (this.isRestarting) return;

        // Initialize the services (FCM, HTTP, Proxy, etc.)
        this.log("Initializing Services...");
        await this.initServices();

        // Start the services
        this.log("Starting Services...");
        await this.startServices();

        // Perform any post-setup tasks/checks
        await this.postChecks();

        // Let everyone know the setup is complete
        this.emit("setup-complete");

        // After setup is complete, start the update checker
        try {
            this.log("Initializing Update Service..");
            this.updater = new UpdateService(this.window);

            const check = Server().repo.getConfig("check_for_updates") as boolean;
            if (check) {
                this.updater.start();
                this.updater.checkForUpdate();
            }
        } catch (ex: any) {
            this.log("There was a problem initializing the update service.", "error");
        }
    }

    /**
     * Performs the initial setup for the server.
     * Mainly, instantiation of a bunch of classes/handlers
     */
    private async initServerComponents(): Promise<void> {
        this.log("Initializing Server Components...");

        // Load notification count
        try {
            this.log("Initializing alert service...");
            const alerts = (await AlertsInterface.find()).filter(item => !item.isRead);
            this.notificationCount = alerts.length;
        } catch (ex: any) {
            this.log("Failed to get initial notification count. Skipping.", "warn");
        }

        // Setup lightweight message cache
        this.log("Initializing event cache...");
        this.eventCache = new EventCache();

        try {
            this.log("Initializing filesystem...");
            FileSystem.setup();
        } catch (ex: any) {
            this.log(`Failed to setup Filesystem! ${ex.message}`, "error");
        }

        try {
            this.log("Initializing caffeinate service...");
            this.caffeinate = new CaffeinateService();
            if (this.repo.getConfig("auto_caffeinate")) {
                this.caffeinate.start();
            }
        } catch (ex: any) {
            this.log(`Failed to setup caffeinate service! ${ex.message}`, "error");
        }

        try {
            this.log("Initializing queue service...");
            this.queue = new QueueService();
        } catch (ex: any) {
            this.log(`Failed to setup queue service! ${ex.message}`, "error");
        }

        try {
            this.log("Initializing network service...");
            this.networkChecker = new NetworkService();
            this.networkChecker.on("status-change", connected => {
                if (connected) {
                    this.log("Re-connected to network!");
                    this.restartProxyServices();
                } else {
                    this.log("Disconnected from network!");
                }
            });

            this.networkChecker.start();
        } catch (ex: any) {
            this.log(`Failed to setup network service! ${ex.message}`, "error");
        }
    }

    async startProxyServices() {
        this.log("Starting Proxy Services...");
        for (const i of this.proxyServices) {
            await i.start();
        }
    }

    async restartProxyServices() {
        this.log("Restarting Proxy Services...");
        for (const i of this.proxyServices) {
            await i.restart();
        }
    }

    async stopProxyServices() {
        this.log("Stopping Proxy Services...");
        for (const i of this.proxyServices) {
            await i.disconnect();
        }
    }

    private async preChecks(): Promise<void> {
        this.log("Running pre-start checks...");

        // Set the dock icon according to the config
        this.setDockIcon();

        try {
            // Restart via terminal if configured
            const restartViaTerminal = Server().repo.getConfig("start_via_terminal") as boolean;
            const parentProc = await findProcess("pid", process.ppid);
            const parentName = isNotEmpty(parentProc) ? parentProc[0].name : null;

            // Restart if enabled and the parent process is the app being launched
            if (restartViaTerminal && (!parentProc[0].name || parentName === "launchd")) {
                this.isRestarting = true;
                this.log("Restarting via terminal after post-check (configured)");
                await this.restartViaTerminal();
            }
        } catch (ex: any) {
            this.log(`Failed to restart via terminal!\n${ex}`);
        }

        // Get the current region
        this.region = await FileSystem.getRegion();

        // Log some server metadata
        this.log(`Server Metadata -> Server Version: v${app.getVersion()}`, "debug");
        this.log(`Server Metadata -> macOS Version: v${osVersion}`, "debug");
        this.log(`Server Metadata -> Local Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`, "debug");
        this.log(`Server Metadata -> Time Synchronization: ${(await FileSystem.getTimeSync()) ?? "N/A"}`, "debug");
        this.log(`Server Metadata -> Detected Region: ${this.region}`, "debug");

        if (!this.region) {
            this.log("No region detected, defaulting to US...", "debug");
            this.region = "US";
        }

        // If the user is on el capitan, we need to force cloudflare
        const proxyService = this.repo.getConfig("proxy_service") as string;
        if (!isMinSierra && proxyService === "Ngrok") {
            this.log("El Capitan detected. Forcing Cloudflare Proxy");
            await this.repo.setConfig("proxy_service", "Cloudflare");
        }

        // If the user is using tcp, force back to http
        const ngrokProtocol = this.repo.getConfig("ngrok_protocol") as string;
        if (ngrokProtocol === "tcp") {
            this.log("TCP protocol detected. Forcing HTTP protocol");
            await this.repo.setConfig("ngrok_protocol", "http");
        }

        this.log("Checking Permissions...");

        // Log if we dont have accessibility access
        if (this.hasAccessibilityAccess) {
            this.log("Accessibility permissions are enabled");
        } else {
            this.log("Accessibility permissions are required for certain actions!", "debug");
        }

        // Log if we dont have accessibility access
        if (this.hasDiskAccess) {
            this.log("Full-disk access permissions are enabled");
        } else {
            this.log("Full-disk access permissions are required!", "error");
        }

        // Make sure Messages is running
        await FileSystem.startMessages();
        const msgCheckInterval = setInterval(async () => {
            try {
                // This won't start it if it's already open
                await FileSystem.startMessages();
            } catch (ex: any) {
                Server().log(`Unable to check if Messages.app is running! CLI Error: ${ex?.message ?? String(ex)}`);
                clearInterval(msgCheckInterval);
            }
        }, 150000); // Make sure messages is open every 2.5 minutes

        this.log("Finished pre-start checks...");
    }

    private async postChecks(): Promise<void> {
        this.log("Running post-start checks...");

        // Make sure a password is set
        const password = this.repo.getConfig("password") as string;
        const tutorialFinished = this.repo.getConfig("tutorial_is_done") as boolean;
        if (tutorialFinished && isEmpty(password)) {
            dialog.showMessageBox(this.window, {
                type: "warning",
                buttons: ["OK"],
                title: "BlueBubbles Warning",
                message: "No Password Set!",
                detail:
                    `No password is currently set. BlueBubbles will not function correctly without one. ` +
                    `Please go to the configuration page, fill in a password, and save the configuration.`
            });
        }

        // Show a warning if the time is off by a reasonable amount (5 seconds)
        try {
            const syncOffset = await FileSystem.getTimeSync();
            if (syncOffset !== null) {
                try {
                    if (Math.abs(syncOffset) >= 5) {
                        this.log(`Your macOS time is not synchronized! Offset: ${syncOffset}`, "warn");
                        this.log(`To fix your time, open terminal and run: "sudo sntp -sS time.apple.com"`, "debug");
                    }
                } catch (ex) {
                    this.log("Unable to parse time synchronization offset!", "debug");
                }
            }
        } catch (ex) {
            this.log(`Failed to get time sychronization status! Error: ${ex}`, "debug");
        }

        this.setDockIcon();

        // Check if on Big Sur+. If we are, then create a log/alert saying that
        if (isMinMonterey) {
            this.log("Warning: macOS Monterey does NOT support creating group chats due to API limitations!", "debug");
        } else if (isMinBigSur) {
            this.log("Warning: macOS Big Sur does NOT support creating group chats due to API limitations!", "debug");
        }

        // Check for contact permissions
        const contactStatus = await requestContactPermission();
        this.log(`Contacts authorization status: ${contactStatus}`, "debug");
        this.log("Finished post-start checks...");
    }

    private setDockIcon() {
        if (!this.repo || !this.repo.db) return;

        const hideDockIcon = this.repo.getConfig("hide_dock_icon") as boolean;
        if (hideDockIcon) {
            app.dock.hide();
            app.show();
        } else {
            app.dock.show();
        }
    }

    /**
     * Handles a configuration change
     *
     * @param prevConfig The previous configuration
     * @param nextConfig The current configuration
     */
    private async handleConfigUpdate({ prevConfig, nextConfig }: ServerConfigChange) {
        // If the socket port changed, disconnect and reconnect
        let proxiesRestarted = false;
        if (prevConfig.socket_port !== nextConfig.socket_port) {
            await this.restartProxyServices();
            if (this.httpService) await this.httpService.restart(true);
            proxiesRestarted = true;
        }

        // If we toggle the custom cert option, restart the http service
        if (prevConfig.use_custom_certificate !== nextConfig.use_custom_certificate && !proxiesRestarted) {
            if (this.httpService) await this.httpService.restart(true);
            proxiesRestarted = true;
        }

        // If the proxy service changed, we need to restart the services
        if (prevConfig.proxy_service !== nextConfig.proxy_service && !proxiesRestarted) {
            await this.restartProxyServices();
            proxiesRestarted = true;
        }

        // If the poll interval changed, we need to restart the listeners
        if (prevConfig.db_poll_interval !== nextConfig.db_poll_interval) {
            this.removeChatListeners();
            this.startChatListeners();
        }

        // If the URL is different, emit the change to the listeners
        if (prevConfig.server_address !== nextConfig.server_address) {
            if (this.httpService) await this.emitMessage(NEW_SERVER, nextConfig.server_address, "high");
            if (this.fcm) await this.fcm.setServerUrl(nextConfig.server_address as string);
        }

        // If the ngrok API key is different, restart the ngrok process
        if (prevConfig.ngrok_key !== nextConfig.ngrok_key && !proxiesRestarted) {
            await this.restartProxyServices();
        }

        // If the ngrok region is different, restart the ngrok process
        if (prevConfig.ngrok_region !== nextConfig.ngrok_region && !proxiesRestarted) {
            await this.restartProxyServices();
        }

        // Install the bundle if the Private API is turned on
        if (!prevConfig.enable_private_api && nextConfig.enable_private_api) {
            if (Server().privateApiHelper === null) {
                Server().privateApiHelper = new BlueBubblesHelperService();
            }

            if (nextConfig.enable_private_api) {
                Server().privateApiHelper.start();
            } else {
                Server().privateApiHelper.stop();
            }
        }

        // If the dock style changes
        if (prevConfig.hide_dock_icon !== nextConfig.hide_dock_icon) {
            this.setDockIcon();
        }

        // If the badge config changes
        if (prevConfig.dock_badge !== nextConfig.dock_badge) {
            if (nextConfig.dock_badge) {
                app.setBadgeCount(this.notificationCount);
            } else {
                app.setBadgeCount(0);
            }
        }

        // If auto-start changes
        if (prevConfig.auto_start !== nextConfig.auto_start) {
            app.setLoginItemSettings({ openAtLogin: nextConfig.auto_start as boolean, openAsHidden: true });
        }

        // Handle when auto caffeinate changes
        if (prevConfig.auto_caffeinate !== nextConfig.auto_caffeinate) {
            if (nextConfig.auto_caffeinate) {
                Server().caffeinate.start();
            } else {
                Server().caffeinate.stop();
            }
        }

        // Handle change in facetime service toggle
        if (prevConfig.facetime_detection !== nextConfig.facetime_detection) {
            if (nextConfig.facetime_detection) {
                this.startFacetimeListener();
            } else {
                this.facetime.stop();
            }
        }

        this.emitToUI("config-update", nextConfig);
    }

    /**
     * Emits a notification to to your connected devices over FCM and socket
     *
     * @param type The type of notification
     * @param data Associated data with the notification (as a string)
     */
    async emitMessage(
        type: string,
        data: any,
        priority: "normal" | "high" = "normal",
        sendFcmMessage = true,
        sendSocket = true
    ) {
        if (sendSocket) {
            this.httpService.socketServer.emit(type, data);
        }

        // Send notification to devices
        try {
            if (sendFcmMessage && FCMService.getApp()) {
                const devices = await this.repo.devices().find();
                if (isNotEmpty(devices)) {
                    const notifData = JSON.stringify(data);
                    await this.fcm.sendNotification(
                        devices.map(device => device.identifier),
                        { type, data: notifData },
                        priority
                    );
                }
            }
        } catch (ex: any) {
            this.log("Failed to send FCM messages!", "debug");
            this.log(ex, "debug");
        }

        // Dispatch the webhook
        this.webhookService.dispatch({ type, data });
    }

    private getTheme() {
        nativeTheme.on("updated", () => {
            this.setTheme(nativeTheme.shouldUseDarkColors);
        });
    }

    private setTheme(shouldUseDarkColors: boolean) {
        if (shouldUseDarkColors === true) {
            this.emitToUI("theme-update", "dark");
        } else {
            this.emitToUI("theme-update", "light");
        }
    }

    async emitMessageMatch(message: Message, tempGuid: string) {
        // Insert chat & participants
        const newMessage = await insertChatParticipants(message);
        this.log(`Message match found for text, [${newMessage.contentString()}]`);

        // Convert to a response JSON
        // Since we sent the message, we don't need to include the participants
        const resp = await MessageSerializer.serialize({
            message: newMessage,
            config: {
                loadChatParticipants: false
            },
            isForNotification: true
        });
        resp.tempGuid = tempGuid;

        // We are emitting this as a new message, the only difference being the included tempGuid
        await this.emitMessage(NEW_MESSAGE, resp);
    }

    async emitMessageError(message: Message, tempGuid: string = null) {
        this.log(`Failed to send message: [${message.contentString()}] (Temp GUID: ${tempGuid ?? "N/A"})`);

        /**
         * ERROR CODES:
         * 4: Message Timeout
         */
        // Since this is a message send error, we don't need to include the participants
        const data = await MessageSerializer.serialize({
            message,
            config: {
                loadChatParticipants: false
            },
            isForNotification: true
        });
        if (isNotEmpty(tempGuid)) {
            data.tempGuid = tempGuid;
        }

        await this.emitMessage("message-send-error", data);
    }

    async checkPrivateApiRequirements(): Promise<Array<NodeJS.Dict<any>>> {
        const output = [];

        // Check if the MySIMBL/MacForge folder exists
        if (isMinMojave) {
            output.push({
                name: "MacForge Plugins Folder",
                pass: fs.existsSync(FileSystem.libMacForgePlugins),
                solution: `Manually create this folder: ${FileSystem.libMacForgePlugins}`
            });
        } else {
            output.push({
                name: "MySIMBL Plugins Folder",
                pass: fs.existsSync(FileSystem.libMySimblPlugins),
                solution: `Manually create this folder: ${FileSystem.libMySimblPlugins}`
            });
        }

        output.push({
            name: "SIP Disabled",
            pass: await FileSystem.isSipDisabled(),
            solution:
                `Follow our documentation on how to disable SIP: ` +
                `https://docs.bluebubbles.app/private-api/installation`
        });

        return output;
    }

    async checkPermissions(): Promise<Array<NodeJS.Dict<any>>> {
        const output = [
            {
                name: "Accessibility",
                pass: systemPreferences.isTrustedAccessibilityClient(false),
                solution: "Open System Preferences > Security > Privacy > Accessibility, then add BlueBubbles"
            },
            {
                name: "Full Disk Access",
                pass: this.hasDiskAccess,
                solution:
                    "Open System Preferences > Security > Privacy > Full Disk Access, " +
                    "then add BlueBubbles. Lastly, restart BlueBubbles."
            }
        ];

        return output;
    }

    /**
     * Starts the chat listener service. This service will listen for new
     * iMessages from your chat database. Anytime there is a new message,
     * we will emit a message to the socket, as well as the FCM server
     */
    private startChatListeners() {
        if (!this.hasDiskAccess) {
            AlertsInterface.create(
                "info",
                "Restart the app once 'Full Disk Access' and 'Accessibility' permissions are enabled"
            );
            return;
        }

        this.log("Starting chat listeners...");
        const pollInterval = (this.repo.getConfig("db_poll_interval") as number) ?? 1000;

        // Create a listener to listen for new/updated messages
        const incomingMsgListener = new IncomingMessageListener(this.iMessageRepo, this.eventCache, pollInterval);
        const outgoingMsgListener = new OutgoingMessageListener(this.iMessageRepo, this.eventCache, pollInterval * 1.5);

        // No real rhyme or reason to multiply this by 2. It's just not as much a priority
        const groupEventListener = new GroupChangeListener(this.iMessageRepo, pollInterval * 2);

        // Add to listeners
        this.chatListeners = [outgoingMsgListener, incomingMsgListener, groupEventListener];

        /**
         * Message listener for my messages only. We need this because messages from ourselves
         * need to be fully sent before forwarding to any clients. If we emit a notification
         * before the message is sent, it will cause a duplicate.
         */
        outgoingMsgListener.on("new-entry", async (item: Message) => {
            const newMessage = await insertChatParticipants(item);
            this.log(`New Message from You, ${newMessage.contentString()}`);

            // Manually send the message to the socket so we can serialize it with
            // all the extra data
            this.httpService.socketServer.emit(
                NEW_MESSAGE,
                await MessageSerializer.serialize({
                    message: newMessage,
                    config: {
                        parseAttributedBody: true,
                        parseMessageSummary: true,
                        parsePayloadData: true,
                        loadChatParticipants: false,
                        includeChats: true
                    }
                })
            );

            // Emit it to the FCM devices, but not socket
            await this.emitMessage(
                NEW_MESSAGE,
                await MessageSerializer.serialize({
                    message: newMessage,
                    config: {
                        enforceMaxSize: true
                    },
                    isForNotification: true
                }),
                "normal",
                true,
                false
            );
        });

        /**
         * Message listener checking for updated messages. This means either the message's
         * delivered date or read date have changed since the last time we checked the database.
         */
        outgoingMsgListener.on("updated-entry", async (item: Message) => {
            const newMessage = await insertChatParticipants(item);

            // ATTENTION: If "from" is null, it means you sent the message from a group chat
            // Check the isFromMe key prior to checking the "from" key
            const from = newMessage.isFromMe ? "You" : newMessage.handle?.id;
            const time =
                newMessage.dateDelivered ?? newMessage.dateRead ?? newMessage.dateEdited ?? newMessage.dateRetracted;
            const updateType = newMessage.dateRetracted
                ? "Text Unsent"
                : newMessage.dateEdited
                ? "Text Edited"
                : newMessage.dateRead
                ? "Text Read"
                : "Text Delivered";

            // Husky pre-commit validator was complaining, so I created vars
            const content = newMessage.contentString();
            const localeTime = time?.toLocaleString();
            this.log(`Updated message from [${from}]: [${content}] - [${updateType} -> ${localeTime}]`);

            // Manually send the message to the socket so we can serialize it with
            // all the extra data
            this.httpService.socketServer.emit(
                MESSAGE_UPDATED,
                await MessageSerializer.serialize({
                    message: newMessage,
                    config: {
                        parseAttributedBody: true,
                        parseMessageSummary: true,
                        parsePayloadData: true,
                        loadChatParticipants: false,
                        includeChats: true
                    }
                })
            );

            // Emit it to the FCM devices only
            // Since this is a message update, we do not need to include the participants or chats
            await this.emitMessage(
                MESSAGE_UPDATED,
                MessageSerializer.serialize({
                    message: newMessage,
                    config: {
                        loadChatParticipants: false,
                        includeChats: false
                    },
                    isForNotification: true
                }),
                "normal",
                true,
                false
            );
        });

        /**
         * Message listener for messages that have errored out
         */
        outgoingMsgListener.on("message-send-error", async (item: Message) => {
            await this.emitMessageError(item);
        });

        /**
         * Message listener for new messages not from yourself. See 'myMsgListener' comment
         * for why we separate them out into two separate listeners.
         */
        incomingMsgListener.on("new-entry", async (item: Message) => {
            const newMessage = await insertChatParticipants(item);
            this.log(`New message from [${newMessage.handle?.id}]: [${newMessage.contentString()}]`);

            // Manually send the message to the socket so we can serialize it with
            // all the extra data
            this.httpService.socketServer.emit(
                NEW_MESSAGE,
                await MessageSerializer.serialize({
                    message: newMessage,
                    config: {
                        parseAttributedBody: true,
                        parseMessageSummary: true,
                        parsePayloadData: true,
                        loadChatParticipants: false,
                        includeChats: true
                    }
                })
            );

            // Emit it to the FCM devices only
            await this.emitMessage(
                NEW_MESSAGE,
                await MessageSerializer.serialize({
                    message: newMessage,
                    config: {
                        enforceMaxSize: true
                    },
                    isForNotification: true
                }),
                "high",
                true,
                false
            );
        });

        groupEventListener.on("name-change", async (item: Message) => {
            this.log(`Group name for [${item.cacheRoomnames}] changed to [${item.groupTitle}]`);

            // Manually send the message to the socket so we can serialize it with
            // all the extra data
            this.httpService.socketServer.emit(
                GROUP_NAME_CHANGE,
                await MessageSerializer.serialize({
                    message: item,
                    config: {
                        loadChatParticipants: true,
                        includeChats: true
                    }
                })
            );

            // Group name changes don't require the participants to be loaded
            await this.emitMessage(
                GROUP_NAME_CHANGE,
                await MessageSerializer.serialize({
                    message: item,
                    config: {
                        loadChatParticipants: false
                    },
                    isForNotification: true
                }),
                "normal",
                true,
                false
            );
        });

        groupEventListener.on("participant-removed", async (item: Message) => {
            const from = item.isFromMe || item.handleId === 0 ? "You" : item.handle?.id;
            this.log(`[${from}] removed [${item.otherHandle}] from [${item.cacheRoomnames}]`);

            // Manually send the message to the socket so we can serialize it with
            // all the extra data
            this.httpService.socketServer.emit(
                PARTICIPANT_REMOVED,
                await MessageSerializer.serialize({
                    message: item,
                    config: {
                        loadChatParticipants: true,
                        includeChats: true
                    }
                })
            );

            await this.emitMessage(
                PARTICIPANT_REMOVED,
                await MessageSerializer.serialize({
                    message: item,
                    isForNotification: true
                }),
                "normal",
                true,
                false
            );
        });

        groupEventListener.on("participant-added", async (item: Message) => {
            const from = item.isFromMe || item.handleId === 0 ? "You" : item.handle?.id;
            this.log(`[${from}] added [${item.otherHandle}] to [${item.cacheRoomnames}]`);

            // Manually send the message to the socket so we can serialize it with
            // all the extra data
            this.httpService.socketServer.emit(
                PARTICIPANT_ADDED,
                await MessageSerializer.serialize({
                    message: item,
                    config: {
                        loadChatParticipants: true,
                        includeChats: true
                    }
                })
            );

            await this.emitMessage(
                PARTICIPANT_ADDED,
                await MessageSerializer.serialize({
                    message: item,
                    isForNotification: true
                }),
                "normal",
                true,
                false
            );
        });

        groupEventListener.on("participant-left", async (item: Message) => {
            const from = item.isFromMe || item.handleId === 0 ? "You" : item.handle?.id;
            this.log(`[${from}] left [${item.cacheRoomnames}]`);

            // Manually send the message to the socket so we can serialize it with
            // all the extra data
            this.httpService.socketServer.emit(
                PARTICIPANT_LEFT,
                await MessageSerializer.serialize({
                    message: item,
                    config: {
                        loadChatParticipants: true,
                        includeChats: true
                    }
                })
            );

            await this.emitMessage(
                PARTICIPANT_LEFT,
                await MessageSerializer.serialize({
                    message: item,
                    isForNotification: true
                }),
                "normal",
                true,
                false
            );
        });

        outgoingMsgListener.on("error", (error: Error) => this.log(error.message, "error"));
        incomingMsgListener.on("error", (error: Error) => this.log(error.message, "error"));
        groupEventListener.on("error", (error: Error) => this.log(error.message, "error"));
    }

    private removeChatListeners() {
        // Remove all listeners
        this.log("Removing chat listeners...");
        for (const i of this.chatListeners) i.stop();
        this.chatListeners = [];
    }

    /**
     * Restarts the server
     */
    async hotRestart() {
        this.log("Restarting the server...");

        // Disconnect & reconnect to the iMessage DB
        if (this.iMessageRepo.db.isInitialized) {
            this.log("Reconnecting to iMessage database...");
            await this.iMessageRepo.db.destroy();
            await this.iMessageRepo.db.initialize();
        }

        await this.stopServices();
        await this.startServices();
    }

    async relaunch() {
        this.isRestarting = true;

        // Close everything gracefully
        await this.stopAll();

        // Relaunch the process
        app.relaunch({ args: process.argv.slice(1).concat(["--relaunch"]) });
        app.exit(0);
    }

    async stopAll() {
        await this.stopServices();
        await this.stopServerComponents();
    }

    async restartViaTerminal() {
        this.isRestarting = true;

        // Close everything gracefully
        await this.stopAll();

        // Kick off the restart script
        FileSystem.executeAppleScript(runTerminalScript(process.execPath));

        // Exit the current instance
        app.exit(0);
    }
}
