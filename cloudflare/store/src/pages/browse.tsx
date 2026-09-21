import type { FC } from "hono/jsx";
import type { StoreIndexApp } from "../validate";
import { Icon, Layout, type PageProps } from "./layout";

export type BrowseProps = PageProps & {
  apps: StoreIndexApp[];
  categories: string[];
  active: string | null;
};

export const BrowsePage: FC<BrowseProps> = (p) => (
  <Layout {...p}>
    <section class="hero">
      <h1>Apps for QuireOS devices</h1>
      <p>
        Install from the Store screen on your device. Developers: <a href="/dashboard">sign in</a> to publish an app.
      </p>
    </section>
    {p.categories.length ? (
      <nav class="chips">
        <a class={p.active ? "chip" : "chip on"} href="/">
          All
        </a>
        {p.categories.map((c) => (
          <a class={p.active === c ? "chip on" : "chip"} href={`/?category=${encodeURIComponent(c)}`}>
            {c}
          </a>
        ))}
      </nav>
    ) : null}
    {p.apps.length === 0 ? <p class="muted">No public apps yet.</p> : null}
    <ul class="cards">
      {p.apps.map((a) => (
        <li class="card">
          <a href={`/apps/${a.id}`} class="card-link">
            <Icon icon={a.icon} name={a.name} />
            <div>
              <h2>{a.name}</h2>
              <p class="tagline">{a.tagline}</p>
              <p class="meta">
                by {a.author} · v{a.version} · {a.installs ?? 0} installs
                {a.categories?.length ? ` · ${a.categories.join(", ")}` : ""}
              </p>
            </div>
          </a>
        </li>
      ))}
    </ul>
  </Layout>
);
