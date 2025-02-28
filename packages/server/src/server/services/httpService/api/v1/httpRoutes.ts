import * as KoaRouter from "koa-router";
import { Server } from "@server";
import { isNotEmpty } from "@server/helpers/utils";

// Middleware
import { AuthMiddleware } from "./middleware/authMiddleware";

// Routers
import { ThemeRouter } from "./routers/themeRouter";
import { HandleRouter } from "./routers/handleRouter";
import { MessageRouter } from "./routers/messageRouter";
import { ChatRouter } from "./routers/chatRouter";
import { AttachmentRouter } from "./routers/attachmentRouter";
import { FcmRouter } from "./routers/fcmRouter";
import { ServerRouter } from "./routers/serverRouter";
import { GeneralRouter } from "./routers/generalRouter";
import { UiRouter } from "./routers/uiRouter";
import { SettingsRouter } from "./routers/settingsRouter";
import { ContactRouter } from "./routers/contactRouter";
import { MetricsMiddleware } from "./middleware/metricsMiddleware";
import { TimeoutMiddleware } from "./middleware/timeoutMiddleware";
import { LogMiddleware } from "./middleware/logMiddleware";
import { ErrorMiddleware } from "./middleware/errorMiddleware";
import { MacOsRouter } from "./routers/macosRouter";
import { iCloudRouter } from "./routers/icloudRouter";
import { PrivateApiMiddleware } from "./middleware/privateApiMiddleware";
import { HttpDefinition, HttpMethod, HttpRoute, HttpRouteGroup, KoaMiddleware } from "../../types";
import { SettingsValidator } from "./validators/settingsValidator";
import { MessageValidator } from "./validators/messageValidator";
import { HandleValidator } from "./validators/handleValidator";
import { FcmValidator } from "./validators/fcmValidator";
import { AttachmentValidator } from "./validators/attachmentValidator";
import { ChatValidator } from "./validators/chatValidator";
import { AlertsValidator } from "./validators/alertsValidator";
import { ScheduledMessageValidator } from "./validators/scheduledMessageValidator";
import { ScheduledMessageRouter } from "./routers/scheduledMessageRouter";

export class HttpRoutes {
    static version = 1;

    private static get protected() {
        return [...HttpRoutes.unprotected, AuthMiddleware];
    }

    private static get unprotected() {
        return [MetricsMiddleware, ErrorMiddleware, LogMiddleware, TimeoutMiddleware];
    }

    static api: HttpDefinition = {
        root: "api",
        routeGroups: [
            {
                name: "General",
                middleware: HttpRoutes.protected,
                routes: [
                    {
                        method: HttpMethod.GET,
                        path: "ping",
                        controller: GeneralRouter.ping
                    }
                ]
            },
            {
                name: "macOS",
                middleware: HttpRoutes.protected,
                prefix: "mac",
                routes: [
                    {
                        method: HttpMethod.POST,
                        path: "lock",
                        controller: MacOsRouter.lock
                    },
                    {
                        method: HttpMethod.POST,
                        path: "imessage/restart",
                        controller: MacOsRouter.restartMessagesApp
                    }
                ]
            },
            {
                name: "iCloud",
                middleware: HttpRoutes.protected,
                prefix: "icloud",
                routes: [
                    {
                        method: HttpMethod.GET,
                        path: "findmy/devices",
                        controller: iCloudRouter.devices
                    },
                    {
                        method: HttpMethod.POST,
                        path: "findmy/devices/refresh",
                        controller: iCloudRouter.refreshDevices
                    },
                    {
                        method: HttpMethod.GET,
                        path: "findmy/friends",
                        controller: iCloudRouter.friends
                    },
                    {
                        method: HttpMethod.POST,
                        path: "findmy/friends/refresh",
                        controller: iCloudRouter.refreshFriends
                    }
                ]
            },
            {
                name: "Server",
                middleware: HttpRoutes.protected,
                prefix: "server",
                routes: [
                    {
                        method: HttpMethod.GET,
                        path: "info",
                        controller: ServerRouter.getInfo
                    },
                    {
                        method: HttpMethod.GET,
                        path: "logs",
                        controller: ServerRouter.getLogs
                    },
                    {
                        method: HttpMethod.GET,
                        path: "restart/soft",
                        controller: ServerRouter.restartServices
                    },
                    {
                        method: HttpMethod.GET,
                        path: "restart/hard",
                        controller: ServerRouter.restartAll
                    },
                    {
                        method: HttpMethod.GET,
                        path: "update/check",
                        controller: ServerRouter.checkForUpdate
                    },
                    {
                        method: HttpMethod.GET,
                        path: "alert",
                        controller: ServerRouter.getAlerts
                    },
                    {
                        method: HttpMethod.POST,
                        path: "alert/read",
                        controller: ServerRouter.markAsRead,
                        validators: [AlertsValidator.validateRead]
                    },
                    {
                        method: HttpMethod.GET,
                        path: "statistics/totals",
                        controller: ServerRouter.getStatTotals
                    },
                    {
                        method: HttpMethod.GET,
                        path: "statistics/media",
                        controller: ServerRouter.getStatMedia
                    },
                    {
                        method: HttpMethod.GET,
                        path: "statistics/media/chat",
                        controller: ServerRouter.getStatMediaByChat
                    }
                ]
            },
            {
                name: "FCM",
                middleware: HttpRoutes.protected,
                prefix: "fcm",
                routes: [
                    {
                        method: HttpMethod.POST,
                        path: "device",
                        validators: [FcmValidator.validateRegistration],
                        controller: FcmRouter.registerDevice
                    },
                    {
                        method: HttpMethod.GET,
                        path: "client",
                        controller: FcmRouter.getClientConfig
                    }
                ]
            },
            {
                name: "Attachment",
                middleware: HttpRoutes.protected,
                prefix: "attachment",
                routes: [
                    {
                        method: HttpMethod.GET,
                        path: "count",
                        controller: AttachmentRouter.count
                    },
                    {
                        method: HttpMethod.GET,
                        path: ":guid/download",
                        validators: [AttachmentValidator.validateDownload],
                        controller: AttachmentRouter.download
                    },
                    {
                        method: HttpMethod.GET,
                        path: ":guid/blurhash",
                        validators: [AttachmentValidator.validateDownload],
                        controller: AttachmentRouter.blurhash
                    },
                    {
                        method: HttpMethod.GET,
                        path: ":guid",
                        validators: [AttachmentValidator.validateFind],
                        controller: AttachmentRouter.find
                    }
                ]
            },
            {
                name: "Chat",
                middleware: HttpRoutes.protected,
                prefix: "chat",
                routes: [
                    {
                        method: HttpMethod.POST,
                        path: "new",
                        middleware: [...HttpRoutes.protected],
                        validators: [ChatValidator.validateCreate],
                        controller: ChatRouter.create
                    },
                    {
                        method: HttpMethod.GET,
                        path: "count",
                        controller: ChatRouter.count
                    },
                    {
                        method: HttpMethod.POST,
                        path: "query",
                        validators: [ChatValidator.validateQuery],
                        controller: ChatRouter.query
                    },
                    {
                        method: HttpMethod.GET,
                        path: ":guid/message",
                        validators: [ChatValidator.validateGetMessages],
                        controller: ChatRouter.getMessages
                    },
                    {
                        method: HttpMethod.POST,
                        path: ":guid/read",
                        middleware: [...HttpRoutes.protected, PrivateApiMiddleware],
                        controller: ChatRouter.markRead
                    },
                    {
                        method: HttpMethod.POST,
                        path: ":guid/unread",
                        middleware: [...HttpRoutes.protected, PrivateApiMiddleware],
                        controller: ChatRouter.markUnread
                    },
                    {
                        method: HttpMethod.POST,
                        path: ":guid/participant/add",
                        middleware: [...HttpRoutes.protected, PrivateApiMiddleware],
                        validators: [ChatValidator.validateToggleParticipant],
                        controller: ChatRouter.addParticipant
                    },
                    {
                        method: HttpMethod.POST,
                        path: ":guid/participant/remove",
                        middleware: [...HttpRoutes.protected, PrivateApiMiddleware],
                        validators: [ChatValidator.validateToggleParticipant],
                        controller: ChatRouter.removeParticipant
                    },
                    {
                        method: HttpMethod.GET,
                        path: ":guid/icon",
                        middleware: [...HttpRoutes.protected],
                        controller: ChatRouter.getGroupIcon
                    },
                    {
                        method: HttpMethod.PUT,
                        path: ":guid",
                        middleware: [...HttpRoutes.protected, PrivateApiMiddleware],
                        validators: [ChatValidator.validateUpdate],
                        controller: ChatRouter.update
                    },
                    {
                        method: HttpMethod.GET,
                        path: ":guid",
                        controller: ChatRouter.find
                    },
                    {
                        method: HttpMethod.DELETE,
                        path: ":guid",
                        middleware: [...HttpRoutes.protected, PrivateApiMiddleware],
                        controller: ChatRouter.deleteChat
                    }
                ]
            },
            {
                name: "Message",
                middleware: HttpRoutes.protected,
                prefix: "message",
                routes: [
                    {
                        method: HttpMethod.POST,
                        path: "text",
                        validators: [MessageValidator.validateText],
                        controller: MessageRouter.sendText
                    },
                    {
                        method: HttpMethod.POST,
                        path: "attachment",
                        validators: [MessageValidator.validateAttachment],
                        controller: MessageRouter.sendAttachment
                    },
                    {
                        method: HttpMethod.POST,
                        path: "react",
                        middleware: [...HttpRoutes.protected, PrivateApiMiddleware],
                        validators: [MessageValidator.validateReaction],
                        controller: MessageRouter.react
                    },
                    {
                        method: HttpMethod.GET,
                        path: "count",
                        validators: [MessageValidator.validateCount],
                        controller: MessageRouter.count
                    },
                    {
                        method: HttpMethod.GET,
                        path: "count/updated",
                        validators: [MessageValidator.validateUpdatedCount],
                        controller: MessageRouter.countUpdated
                    },
                    {
                        method: HttpMethod.GET,
                        path: "count/me",
                        controller: MessageRouter.sentCount
                    },
                    {
                        method: HttpMethod.POST,
                        path: "query",
                        validators: [MessageValidator.validateQuery],
                        controller: MessageRouter.query
                    },
                    {
                        method: HttpMethod.GET,
                        path: "schedule",
                        controller: ScheduledMessageRouter.getScheduledMessages
                    },
                    {
                        method: HttpMethod.POST,
                        path: "schedule",
                        validators: [ScheduledMessageValidator.validateScheduledMessage],
                        controller: ScheduledMessageRouter.createScheduledMessage
                    },
                    {
                        method: HttpMethod.GET,
                        path: "schedule/:id",
                        controller: ScheduledMessageRouter.getById
                    },
                    {
                        method: HttpMethod.PUT,
                        path: "schedule/:id",
                        validators: [ScheduledMessageValidator.validateScheduledMessage],
                        controller: ScheduledMessageRouter.updateScheduledMessage
                    },
                    {
                        method: HttpMethod.DELETE,
                        path: "schedule/:id",
                        controller: ScheduledMessageRouter.deleteById
                    },
                    {
                        method: HttpMethod.GET,
                        path: ":guid",
                        validators: [MessageValidator.validateFind],
                        controller: MessageRouter.find
                    },
                    {
                        method: HttpMethod.POST,
                        path: ":guid/edit",
                        validators: [MessageValidator.validateEdit],
                        controller: MessageRouter.editMessage
                    },
                    {
                        method: HttpMethod.POST,
                        path: ":guid/unsend",
                        validators: [MessageValidator.validateUnsend],
                        controller: MessageRouter.unsendMessage
                    }
                ]
            },
            {
                name: "Handle",
                middleware: HttpRoutes.protected,
                prefix: "handle",
                routes: [
                    {
                        method: HttpMethod.GET,
                        path: "count",
                        controller: HandleRouter.count
                    },
                    {
                        method: HttpMethod.POST,
                        path: "query",
                        validators: [HandleValidator.validateQuery],
                        controller: HandleRouter.query
                    },
                    {
                        method: HttpMethod.GET,
                        path: ":guid",
                        validators: [HandleValidator.validateFind],
                        controller: HandleRouter.find
                    }
                ]
            },
            {
                name: "Contact",
                middleware: HttpRoutes.protected,
                prefix: "contact",
                routes: [
                    {
                        method: HttpMethod.GET,
                        path: "",
                        controller: ContactRouter.get
                    },
                    {
                        method: HttpMethod.POST,
                        path: "",
                        controller: ContactRouter.create
                    },
                    {
                        method: HttpMethod.POST,
                        path: "query",
                        controller: ContactRouter.query
                    }
                ]
            },
            {
                name: "Backup",
                middleware: HttpRoutes.protected,
                prefix: "backup",
                routes: [
                    {
                        method: HttpMethod.GET,
                        path: "theme",
                        controller: ThemeRouter.get
                    },
                    {
                        method: HttpMethod.POST,
                        path: "theme",
                        controller: ThemeRouter.create
                    },
                    {
                        method: HttpMethod.GET,
                        path: "settings",
                        controller: SettingsRouter.get
                    },
                    {
                        method: HttpMethod.POST,
                        path: "settings",
                        validators: [SettingsValidator.validate],
                        controller: SettingsRouter.create
                    }
                ]
            }
        ]
    };

    static ui: HttpDefinition = {
        root: "/",
        routeGroups: [
            {
                name: "Index",
                middleware: HttpRoutes.unprotected,
                prefix: "/",
                routes: [
                    {
                        method: HttpMethod.GET,
                        path: "/",
                        controller: UiRouter.index
                    }
                ]
            }
        ]
    };

    static createRoutes(router: KoaRouter) {
        const { api, ui } = HttpRoutes;

        // Load in the API routes
        for (const group of api.routeGroups) {
            for (const route of group.routes) {
                const middleware = HttpRoutes.buildMiddleware(group, route);
                HttpRoutes.registerRoute(
                    router,
                    route.method,
                    [api.root, `v${HttpRoutes.version}`, group.prefix, route.path],
                    middleware
                );
            }
        }

        // Load in the UI routes
        for (const group of ui.routeGroups) {
            for (const route of group.routes) {
                const middleware = HttpRoutes.buildMiddleware(group, route);
                HttpRoutes.registerRoute(router, route.method, [ui.root, group.prefix, route.path], middleware);
            }
        }
    }

    private static buildMiddleware(group: HttpRouteGroup, route: HttpRoute) {
        return [...(route?.middleware ?? group.middleware ?? []), ...(route.validators ?? []), route.controller];
    }

    private static registerRoute(
        router: KoaRouter,
        method: HttpMethod,
        pathParts: string[],
        middleware: KoaMiddleware[]
    ) {
        // Sanitize the path parts so we can accurately build them
        const parts = pathParts.map(i => (i ?? "").replace(/(^\/)|(\/$)/g, "")).filter(i => isNotEmpty(i));

        // Build the path
        const path = `/${parts.join("/")}`;
        Server().log(`Registering route: [${method}] -> ${path}`, "debug");

        // Create the routes based on type
        if (method === HttpMethod.GET) router.get(path, ...middleware);
        if (method === HttpMethod.POST) router.post(path, ...middleware);
        if (method === HttpMethod.PUT) router.put(path, ...middleware);
        if (method === HttpMethod.PATCH) router.patch(path, ...middleware);
        if (method === HttpMethod.DELETE) router.delete(path, ...middleware);
    }
}
