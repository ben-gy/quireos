import type { FC } from "hono/jsx";
import type { AppListing, VersionRow } from "../db";
import { formatDate, parseJsonArray } from "../util";
import { Csrf, Layout, type PageProps } from "./layout";

type Values = { slug?: string; name?: string; tagline?: string; kind?: string; manifest_url?: string };

export const NewAppPage: FC<PageProps & { csrf: string; values: Values }> = (p) => (
  <Layout {...p}>
    <h1>New app</h1>
    <form method="post" action="/apps/new" class="stack">
      <Csrf token={p.csrf} />
      <label>
        Slug (app id; permanent; <code>^[a-z][a-z0-9-]{"{0,31}"}$</code>)
        <input name="slug" required pattern="[a-z][a-z0-9-]{0,31}" value={p.values.slug ?? ""} />
      </label>
      <label>
        Name (≤ 24 chars)
        <input name="name" required maxlength={24} value={p.values.name ?? ""} />
      </label>
      <label>
        Tagline (≤ 80 chars)
        <input name="tagline" maxlength={80} value={p.values.tagline ?? ""} />
      </label>
      <fieldset>
        <legend>Kind</legend>
        <label class="inline">
          <input type="radio" name="kind" value="hosted" checked={p.values.kind !== "external"} /> Hosted: upload a zip bundle; the store serves it
        </label>
        <label class="inline">
          <input type="radio" name="kind" value="external" checked={p.values.kind === "external"} /> External: your own server; give the manifest URL
        </label>
      </fieldset>
      <label>
        Manifest URL (external apps only)
        <input name="manifest_url" type="url" placeholder="https://my-app.example.workers.dev/manifest.json" value={p.values.manifest_url ?? ""} />
      </label>
      <p class="muted">New apps start private. Publish a version, then change visibility on the edit page.</p>
      <button type="submit">Create app</button>
    </form>
  </Layout>
);

export const EditAppPage: FC<PageProps & { csrf: string; app: AppListing; versions: VersionRow[]; iconUrl: string | null; manifestFor: (v: string) => string | null; origin: string }> = (p) => {
  const { app } = p;
  return (
    <Layout {...p}>
      <h1>
        Edit {app.name} <span class="muted">({app.slug})</span>
      </h1>
      <p>
        <a href={`/apps/${app.slug}`}>View store page</a>
        {app.latest_version ? (
          <>
            {" "}
            · manifest: <code>{p.manifestFor(app.latest_version)}</code>
          </>
        ) : null}
      </p>

      <section>
        <h2>Details</h2>
        <form method="post" action={`/apps/${app.slug}/edit`} class="stack">
          <Csrf token={p.csrf} />
          <label>
            Name <input name="name" required maxlength={24} value={app.name} />
          </label>
          <label>
            Tagline <input name="tagline" maxlength={80} value={app.tagline} />
          </label>
          <label>
            Categories (comma separated) <input name="categories" value={parseJsonArray(app.categories).join(", ")} />
          </label>
          <label>
            Visibility
            <select name="visibility">
              {(["private", "unlisted", "public"] as const).map((v) => (
                <option value={v} selected={app.visibility === v}>
                  {v}
                </option>
              ))}
            </select>
            <span class="help">private: only your paired devices · unlisted: anyone with the URL/slug · public: listed</span>
          </label>
          {app.kind === "external" ? (
            <label>
              Manifest URL <input name="manifest_url" type="url" required value={app.manifest_url ?? ""} />
            </label>
          ) : null}
          <label>
            Description (store page; blank line between paragraphs)
            <textarea name="description" rows={6} maxlength={4000}>
              {app.description}
            </textarea>
          </label>
          <label>
            Screenshot URLs (one per line, PNG/JPEG you host)
            <textarea name="screenshots" rows={3}>
              {parseJsonArray(app.screenshots).join("\n")}
            </textarea>
          </label>
          <button type="submit">Save</button>
        </form>
      </section>

      <section>
        <h2>Icon</h2>
        {p.iconUrl ? <img class="icon" src={p.iconUrl} width={96} height={96} alt="" /> : <p class="muted">Using the manifest icon. Upload a 96×96 PNG (≤ 200 kB) to override it.</p>}
        <form method="post" action={`/apps/${app.slug}/icon`} enctype="multipart/form-data" class="inline-form">
          <Csrf token={p.csrf} />
          <input type="file" name="icon" accept="image/png" required />
          <button type="submit">Upload icon</button>
        </form>
        {p.iconUrl ? (
          <form method="post" action={`/apps/${app.slug}/icon`} class="inline-form">
            <Csrf token={p.csrf} />
            <input type="hidden" name="remove" value="1" />
            <button type="submit" class="secondary">
              Remove uploaded icon
            </button>
          </form>
        ) : null}
      </section>

      <section>
        <h2>Publish a version</h2>
        {app.kind === "hosted" ? (
          <form method="post" action={`/apps/${app.slug}/versions`} enctype="multipart/form-data" class="stack">
            <Csrf token={p.csrf} />
            <p class="muted">
              Zip with <code>manifest.json</code> at the root (plus screens, images, <code>icon.png</code>), ≤ 5 MB. The manifest <code>id</code> must be{" "}
              <code>{app.slug}</code> and <code>version</code> must be greater than {app.latest_version ?? "any previous version"}.
            </p>
            <label>
              Bundle <input type="file" name="bundle" accept=".zip,application/zip" required />
            </label>
            <label>
              Changelog <textarea name="changelog" rows={3} maxlength={2000}></textarea>
            </label>
            <button type="submit">Publish</button>
          </form>
        ) : (
          <form method="post" action={`/apps/${app.slug}/versions`} class="stack">
            <Csrf token={p.csrf} />
            <p class="muted">
              The store fetches <code>{app.manifest_url ?? "(set the manifest URL above)"}</code>, validates it and snapshots it as a new version. Its{" "}
              <code>version</code> must be greater than {app.latest_version ?? "any previous version"}.
            </p>
            <label>
              Changelog <textarea name="changelog" rows={3} maxlength={2000}></textarea>
            </label>
            <button type="submit" disabled={!app.manifest_url}>
              Fetch manifest and publish
            </button>
          </form>
        )}
      </section>

      <section>
        <h2>Versions</h2>
        {p.versions.length ? (
          <table>
            <thead>
              <tr>
                <th>Version</th>
                <th>Min OS</th>
                <th>Published</th>
                <th>Manifest</th>
                <th>Changelog</th>
              </tr>
            </thead>
            <tbody>
              {p.versions.map((v) => (
                <tr>
                  <td>{v.version}</td>
                  <td>{v.min_os}</td>
                  <td>{formatDate(v.published_at)}</td>
                  <td>{p.manifestFor(v.version) ? <a href={p.manifestFor(v.version)!}>manifest.json</a> : "—"}</td>
                  <td class="pre">{v.changelog || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p class="muted">Nothing published yet. The app appears in the store once a version exists.</p>
        )}
      </section>

      <section class="danger">
        <h2>Delete app</h2>
        <form method="post" action={`/apps/${app.slug}/delete`} class="inline-form">
          <Csrf token={p.csrf} />
          <label>
            Type the slug to confirm <input name="confirm" placeholder={app.slug} />
          </label>
          <button type="submit" class="danger">
            Delete app and all versions
          </button>
        </form>
      </section>
    </Layout>
  );
};
