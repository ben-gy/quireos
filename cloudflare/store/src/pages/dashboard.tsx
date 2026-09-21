import type { FC } from "hono/jsx";
import type { AppListing } from "../db";
import type { Device } from "../env";
import { formatDate } from "../util";
import { Layout, type PageProps } from "./layout";

export const DashboardPage: FC<PageProps & { apps: AppListing[]; devices: Device[]; counts: Map<string, number>; maxApps: number }> = (p) => (
  <Layout {...p}>
    <h1>Dashboard</h1>
    <section>
      <h2>
        Your apps <span class="muted">({p.apps.length}/{p.maxApps})</span>
      </h2>
      {p.apps.length < p.maxApps ? (
        <p>
          <a class="btn" href="/apps/new">
            New app
          </a>
        </p>
      ) : (
        <p class="muted">You have reached the limit of {p.maxApps} apps.</p>
      )}
      {p.apps.length ? (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Slug</th>
              <th>Kind</th>
              <th>Visibility</th>
              <th>Latest</th>
              <th>Installs</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {p.apps.map((a) => (
              <tr>
                <td>
                  <a href={`/apps/${a.slug}`}>{a.name}</a>
                </td>
                <td>
                  <code>{a.slug}</code>
                </td>
                <td>{a.kind}</td>
                <td>
                  {a.visibility}
                  {a.unlisted_by_admin ? " (unlisted by admin)" : ""}
                </td>
                <td>{a.latest_version ?? <span class="muted">unpublished</span>}</td>
                <td>{p.counts.get(a.slug) ?? 0}</td>
                <td>
                  <a href={`/apps/${a.slug}/edit`}>Edit</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p class="muted">No apps yet.</p>
      )}
    </section>
    <section>
      <h2>Your devices</h2>
      {p.devices.length ? (
        <ul>
          {p.devices.map((d) => (
            <li>
              {d.name || d.hw_id} · QuireOS {d.os_version ?? "?"} · {d.screen ?? "?"} · last seen {formatDate(d.last_seen)}
            </li>
          ))}
        </ul>
      ) : (
        <p class="muted">
          No paired devices. On the device open Store → Pair with account, then enter the code at <a href="/pair">/pair</a>.
        </p>
      )}
      <p>
        <a href="/devices">Manage devices</a>
      </p>
    </section>
  </Layout>
);
