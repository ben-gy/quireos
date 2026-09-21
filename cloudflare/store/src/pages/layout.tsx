import { raw } from "hono/html";
import type { FC, PropsWithChildren } from "hono/jsx";
import type { User } from "../env";

export type PageProps = {
  title: string;
  storeName: string;
  user: User | null;
  ok?: string;
  err?: string;
};

export const Layout: FC<PropsWithChildren<PageProps>> = ({ title, storeName, user, ok, err, children }) => (
  <>
    {raw("<!DOCTYPE html>")}
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title === storeName ? storeName : `${title} · ${storeName}`}</title>
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body>
        <header class="top">
          <a class="brand" href="/">
            {storeName}
          </a>
          <nav>
            <a href="/">Browse</a>
            {user ? (
              <>
                <a href="/dashboard">Dashboard</a>
                <a href="/devices">Devices</a>
                <a href="/pair">Pair</a>
                {user.is_admin ? <a href="/admin">Admin</a> : null}
                <a href="/logout">Sign out ({user.login})</a>
              </>
            ) : (
              <a href="/login">Sign in with GitHub</a>
            )}
          </nav>
        </header>
        <main>
          {ok ? <p class="notice ok">{ok}</p> : null}
          {err ? <p class="notice err">{err}</p> : null}
          {children}
        </main>
        <footer>
          <a href="https://github.com/ben-gy/quireos">QuireOS</a> · open source · <a href="/api/v1/index">index.json</a>
        </footer>
      </body>
    </html>
  </>
);

export const Icon: FC<{ icon: string; name: string; size?: number }> = ({ icon, name, size = 48 }) =>
  /^https?:\/\//.test(icon) ? (
    <img class="icon" src={icon} alt="" width={size} height={size} loading="lazy" />
  ) : (
    <span class="icon icon-name" style={`width:${size}px;height:${size}px`} title={`icon: ${icon}`}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );

export const Csrf: FC<{ token: string }> = ({ token }) => <input type="hidden" name="_csrf" value={token} />;
