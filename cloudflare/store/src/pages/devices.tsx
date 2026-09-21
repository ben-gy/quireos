import type { FC } from "hono/jsx";
import type { Device } from "../env";
import { formatDate } from "../util";
import { Csrf, Layout, type PageProps } from "./layout";

export const DevicesPage: FC<PageProps & { csrf: string; devices: Device[] }> = (p) => (
  <Layout {...p}>
    <h1>Devices</h1>
    <p class="muted">
      Paired devices see your private and unlisted apps in their Store. To pair a new device: Store → Pair with account on the device, then{" "}
      <a href="/pair">enter the code</a>.
    </p>
    {p.devices.length ? (
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>OS</th>
            <th>Screen</th>
            <th>Last seen</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {p.devices.map((d) => (
            <tr>
              <td>
                <form method="post" action={`/devices/${d.id}/rename`} class="inline-form">
                  <Csrf token={p.csrf} />
                  <input name="name" maxlength={40} value={d.name ?? ""} placeholder={d.hw_id} />
                  <button type="submit" class="secondary">
                    Rename
                  </button>
                </form>
              </td>
              <td>{d.os_version ?? "?"}</td>
              <td>{d.screen ?? "?"}</td>
              <td>{formatDate(d.last_seen)}</td>
              <td>
                <form method="post" action={`/devices/${d.id}/unpair`} class="inline-form">
                  <Csrf token={p.csrf} />
                  <button type="submit" class="danger">
                    Unpair
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    ) : (
      <p class="muted">No paired devices.</p>
    )}
  </Layout>
);

export const PairPage: FC<PageProps & { csrf: string; code: string }> = (p) => (
  <Layout {...p}>
    <h1>Pair a device</h1>
    <p>On your QuireOS device open Store → Pair with account, then type the six-character code here.</p>
    <form method="post" action="/pair" class="stack narrow">
      <Csrf token={p.csrf} />
      <label>
        Code <input name="code" class="code" required maxlength={7} autocomplete="off" autocapitalize="characters" value={p.code} placeholder="ABC234" />
      </label>
      <button type="submit">Pair</button>
    </form>
  </Layout>
);
