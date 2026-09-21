import type { FC } from "hono/jsx";
import type { AppListing, ReportRow } from "../db";
import { formatDate } from "../util";
import { Csrf, Layout, type PageProps } from "./layout";

export const AdminPage: FC<PageProps & { csrf: string; apps: AppListing[]; reports: ReportRow[] }> = (p) => (
  <Layout {...p}>
    <h1>Admin</h1>
    <section>
      <h2>Reports ({p.reports.length})</h2>
      {p.reports.length ? (
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>App</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {p.reports.map((r) => (
              <tr>
                <td>{formatDate(r.at)}</td>
                <td>
                  <a href={`/apps/${r.app_slug}`}>{r.app_slug}</a>
                </td>
                <td class="pre">{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p class="muted">No reports.</p>
      )}
    </section>
    <section>
      <h2>All apps ({p.apps.length})</h2>
      <table>
        <thead>
          <tr>
            <th>Slug</th>
            <th>Owner</th>
            <th>Kind</th>
            <th>Visibility</th>
            <th>Latest</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {p.apps.map((a) => (
            <tr>
              <td>
                <a href={`/apps/${a.slug}`}>{a.slug}</a>
              </td>
              <td>{a.owner_login}</td>
              <td>{a.kind}</td>
              <td>
                {a.visibility}
                {a.unlisted_by_admin ? " · UNLISTED BY ADMIN" : ""}
              </td>
              <td>{a.latest_version ?? "—"}</td>
              <td>
                <form method="post" action={`/admin/apps/${a.slug}/${a.unlisted_by_admin ? "relist" : "unlist"}`} class="inline-form">
                  <Csrf token={p.csrf} />
                  <button type="submit" class={a.unlisted_by_admin ? "secondary" : "danger"}>
                    {a.unlisted_by_admin ? "Relist" : "Unlist"}
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  </Layout>
);
