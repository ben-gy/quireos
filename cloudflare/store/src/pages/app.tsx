import type { FC } from "hono/jsx";
import type { AppListing, VersionRow } from "../db";
import { formatDate } from "../util";
import type { StoreApp } from "../validate";
import { Csrf, Icon, Layout, type PageProps } from "./layout";

export type AppPageProps = PageProps & {
  app: AppListing;
  entry: StoreApp | null;
  versions: VersionRow[];
  screenshots: string[];
  manifestFor: (v: string) => string | null;
  isOwner: boolean;
  csrf: string;
};

export const AppPage: FC<AppPageProps> = (p) => {
  const { app, entry } = p;
  const manifest = entry?.manifest ?? null;
  return (
    <Layout {...p}>
      <article class="app">
        <header class="app-head">
          <Icon icon={entry?.icon ?? "apps"} name={app.name} size={96} />
          <div>
            <h1>{app.name}</h1>
            <p class="tagline">{app.tagline}</p>
            <p class="meta">
              by {app.owner_login} · {app.kind} · {entry ? `v${entry.version} · needs QuireOS ${entry.min_os}` : "no published version"}
              {entry?.installs !== undefined ? ` · ${entry.installs} installs` : ""}
              {entry?.categories?.length ? ` · ${entry.categories.join(", ")}` : ""}
            </p>
            {app.visibility !== "public" ? <p class="badge">{app.visibility}</p> : null}
            {app.unlisted_by_admin ? <p class="badge warn">unlisted by an admin</p> : null}
            {p.isOwner ? (
              <p>
                <a class="btn" href={`/apps/${app.slug}/edit`}>
                  Edit
                </a>
              </p>
            ) : null}
          </div>
        </header>

        <section class="install">
          <h2>Install</h2>
          <p>Open the Store on your QuireOS device and pick “{app.name}”.</p>
          {manifest ? (
            <p>
              Or install from URL (device LAN page):
              <input class="copy" type="text" readonly value={manifest} onfocus="this.select()" />
            </p>
          ) : null}
        </section>

        {app.description ? (
          <section>
            <h2>About</h2>
            {app.description.split(/\n{2,}/).map((para) => (
              <p>{para}</p>
            ))}
          </section>
        ) : null}

        {p.screenshots.length ? (
          <section class="shots">
            <h2>Screenshots</h2>
            {p.screenshots.map((s) => (
              <img src={s} alt="" loading="lazy" />
            ))}
          </section>
        ) : null}

        {p.versions.length ? (
          <section>
            <h2>Versions</h2>
            <table>
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Min OS</th>
                  <th>Published</th>
                  <th>Changelog</th>
                </tr>
              </thead>
              <tbody>
                {p.versions.map((v) => (
                  <tr>
                    <td>
                      {p.manifestFor(v.version) ? <a href={p.manifestFor(v.version)!}>{v.version}</a> : v.version}
                    </td>
                    <td>{v.min_os}</td>
                    <td>{formatDate(v.published_at)}</td>
                    <td class="pre">{v.changelog || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        <section class="report">
          <details>
            <summary>Report this app</summary>
            <form method="post" action={`/apps/${app.slug}/report`}>
              <Csrf token={p.csrf} />
              <label>
                Reason
                <select name="kind">
                  <option value="spam">Spam</option>
                  <option value="malicious">Malicious or harmful</option>
                  <option value="inappropriate">Inappropriate content</option>
                  <option value="broken">Does not work</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label>
                Details
                <textarea name="details" maxlength={1000} rows={3}></textarea>
              </label>
              <button type="submit">Send report</button>
            </form>
          </details>
        </section>
      </article>
    </Layout>
  );
};
