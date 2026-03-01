import { checkerRouter } from "./router/checker";
import { incidentRouter } from "./router/incident";
import { maintenanceRouter } from "./router/maintenance";
import { monitorRouter } from "./router/monitor";
import { monitorDataRouter } from "./router/monitorData";
import { monitorTagRouter } from "./router/monitorTag";
import { notificationRouter } from "./router/notification";
import { pageRouter } from "./router/page";
import { pageComponentRouter } from "./router/pageComponent";
import { pageSubscriberRouter } from "./router/pageSubscriber";
import { privateLocationRouter } from "./router/privateLocation";
import { statusPageRouter } from "./router/statusPage";
import { statusReportRouter } from "./router/statusReport";
import { userRouter } from "./router/user";
import { workspaceRouter } from "./router/workspace";
import { createTRPCRouter } from "./trpc";

// Deployed to /trpc/edge/**
export const edgeRouter = createTRPCRouter({
  workspace: workspaceRouter,
  monitor: monitorRouter,
  monitorData: monitorDataRouter,
  page: pageRouter,
  pageComponent: pageComponentRouter,
  statusReport: statusReportRouter,
  user: userRouter,
  notification: notificationRouter,
  incident: incidentRouter,
  pageSubscriber: pageSubscriberRouter,
  monitorTag: monitorTagRouter,
  maintenance: maintenanceRouter,
  checker: checkerRouter,
  statusPage: statusPageRouter,
  privateLocation: privateLocationRouter,
});
