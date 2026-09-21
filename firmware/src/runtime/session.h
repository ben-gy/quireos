// AppSession: everything the device does for one running app (SPEC §6-§8): screen loading with
// history, data sources with TTL/ETag, vars, image slots, template rebinding, action execution,
// network policy and secret gating. It never touches the network directly: it hands FetchRequests to
// a Fetcher and receives FetchResults back from the OS loop.
#pragma once
#include <string>
#include <vector>
#include "expr.h"
#include "png_decode.h"
#include "renderer.h"
#include "screen_parser.h"

namespace quire {
namespace rt {

struct FetchRequest {
  uint32_t tag = 0;
  std::string method = "GET";
  std::string url;
  std::vector<std::string> headers;   // "Name: value"
  std::string body;
  size_t max_bytes = SCREEN_MAX_BYTES;
  const char *accept = "application/json";
};
struct FetchResult {
  uint32_t tag = 0;
  int status = 0;
  int error = 0;                      // hal::HttpError
  const uint8_t *body = nullptr;      // NUL-terminated; valid during on_response() only
  size_t len = 0;
  const char *etag = "";
  const char *content_type = "";
};
class Fetcher {
 public:
  virtual ~Fetcher() {}
  virtual bool fetch(const FetchRequest &req) = 0;    // false when the queue is full: try later
};

struct DeviceInfo {
  int battery = -1;
  bool charging = false;
  int rssi = 0;
  bool online = true;
  std::string name = "QuireOS";
  std::string tz = "UTC";
  int w = 540, h = 960, greys = 16, dpi = 235;
};

struct RenderPlan {
  bool full = false;
  hal::Rect rects[16];
  int count = 0;
  Refresh hint = Refresh::AUTO;
  void add(hal::Rect r) {
    if (r.empty() || full) return;
    if (count >= 16) { full = true; count = 0; return; }
    rects[count++] = r;
  }
};

class AppSession : public expr::Resolver {
 public:
  enum class State : uint8_t { IDLE = 0, LOADING, READY, NEEDS_SETUP, ERROR, UPDATE_OS };

  AppSession();
  ~AppSession();

  // The manifest is parsed into `manifest` by the caller before open(). `settings_json` is the
  // stored settings object (secrets included). Returns false when the app cannot start.
  bool open(Fetcher *fetcher, const std::string &manifest_url, const std::string &install_id,
            const char *settings_json, const DeviceInfo &dev);
  void close();

  AppManifest manifest;

  State state() const { return state_; }
  const char *error_message() const { return error_.c_str(); }
  const char *error_code() const { return error_code_.c_str(); }
  const std::vector<std::string> &missing_settings() const { return missing_; }

  // Drive it.
  void tick(uint32_t now_ms, int64_t epoch);
  void on_response(const FetchResult &res);
  void set_device(const DeviceInfo &dev);              // battery/rssi/online changes
  void tap(int x, int y, bool hold, int64_t epoch);    // runs the widget's action
  bool run_key(bool double_press, int64_t epoch);      // §6 keys; false when the screen did not claim it
  bool background_failed() const { return background_failed_; }   // a periodic refresh is failing
  bool busy() const { return screen_inflight_ && state_ == State::LOADING; }
  void retry();                                        // from the error screen
  void home();
  void back();
  void refresh();

  // Rendering (the OS owns the framebuffer).
  bool take_render(RenderPlan &plan);                  // true when something must be drawn
  const WidgetTree &tree() const;
  WidgetTree &tree();
  const RenderImages &images() const { return render_images_; }
  const ScreenMeta &meta() const;
  bool has_screen() const { return screen_loaded_ && screen_ != nullptr; }
  // Transient alerts (http failures, refused requests). Returns "" when none.
  const char *take_alert();
  int hit_test(int x, int y) const { return tree().hit_test(x, y); }
  uint32_t next_timer_ms(uint32_t now_ms) const;       // time until the next timer, for sleep

  // expr::Resolver
  JsonVariantConst root(const char *name) override;
  void note_settings_ref(const char *key) override;
  const tz::Zone &zone() override { return zone_; }

  // Exposed for tests.
  bool origin_allowed(const std::string &origin) const;
  bool build_request(const std::string &url_tpl, JsonVariantConst headers, JsonVariantConst body, bool body_raw,
                     const char *method, FetchRequest &out, std::string &err);
  const std::vector<std::string> &allowed_origins() const { return allowed_; }
  std::string app_settings_header() const { return settings_header_; }

 private:
  enum Kind : uint32_t { K_SCREEN = 1, K_DATA = 2, K_IMAGE = 3, K_HTTP = 4, K_SUBMIT = 5 };
  enum class LoadMode : uint8_t { OPEN, NAVIGATE_PUSH, NAVIGATE_REPLACE, REFRESH, BACKGROUND, HOME, BACK, SUBMIT };
  static bool foreground(LoadMode m) { return m != LoadMode::REFRESH && m != LoadMode::BACKGROUND && m != LoadMode::SUBMIT; }
  struct DataState {
    JsonDocument doc;
    std::string etag;
    uint32_t due_ms = 0;
    bool loaded = false, failed = false, inflight = false;
    int backoff = 0;
  };
  struct ImageState {
    ImageBuf buf;
    std::string url, etag;
    uint32_t due_ms = 0;
    bool inflight = false;
  };
  struct Then { bool armed = false, wait = false; std::string type, url; uint32_t at_ms = 0; int after = 0; };

  uint32_t make_tag(Kind k, int index) const { return (uint32_t)k << 24 | (gen_ & 0xFFFF) << 8 | (uint32_t)(index & 0xFF); }
  bool enqueue(FetchRequest &req);
  void pump_outbox();
  void compute_allowed();
  void load_screen(const std::string &url, LoadMode mode, const std::string &post_body = "");
  void handle_screen_response(const FetchResult &res);
  void handle_data_response(int idx, const FetchResult &res);
  void handle_image_response(int idx, const FetchResult &res);
  void handle_http_response(const FetchResult &res);
  void handle_submit_response(const FetchResult &res);
  void adopt_screen(const std::string &fetched_url, const std::string &etag, LoadMode mode);
  void start_data_fetches(bool force);
  void fetch_data(int idx);
  void fetch_images(bool force);
  void finalize_first_render();
  void init_vars();
  void rebind(bool force_full);
  void set_error(const char *code, const std::string &message);
  void alert(const std::string &message);
  void run_action(JsonVariantConst action, int widget_index, int x, int y, int64_t epoch);
  void apply_set(JsonVariantConst set);
  void run_then(const Then &t);
  void arm_backoff();
  void arm_then(JsonVariantConst action, bool wait);
  void render_json(JsonVariantConst src, JsonVariant dst);
  std::string screen_origin() const;
  bool add_screen_headers(FetchRequest &req, const std::string &url, const std::string &etag);
  std::string resolve_url(const std::string &u, std::string &err) const;
  void clear_data();
  void clear_images();
  void update_device_doc(int64_t epoch);

  Fetcher *fetcher_ = nullptr;
  State state_ = State::IDLE;
  std::string error_, error_code_;
  std::vector<std::string> missing_;
  std::string manifest_url_, app_origin_, install_id_;
  std::vector<std::string> allowed_;
  bool app_origin_in_hosts_ = false;
  JsonDocument settings_all_, settings_public_, vars_, device_;
  std::string settings_header_;
  DeviceInfo dev_;
  tz::Zone zone_;

  ParsedScreen *screen_ = nullptr, *pending_ = nullptr;
  mutable WidgetTree empty_;
  bool screen_loaded_ = false;
  std::string screen_url_, screen_etag_, pending_url_, error_url_;
  LoadMode error_mode_ = LoadMode::OPEN;
  LoadMode pending_mode_ = LoadMode::OPEN;
  std::string pending_body_;   // for submit
  uint32_t gen_ = 1;
  bool screen_inflight_ = false;
  uint32_t screen_due_ms_ = 0;
  int backoff_idx_ = 0;
  bool first_render_pending_ = false;
  int awaiting_data_ = 0;

  DataState data_[MAX_DATA];
  ImageState images_[MAX_IMAGES];
  RenderImages render_images_;

  struct HistEntry { std::string url; };
  std::vector<HistEntry> history_;

  RenderPlan plan_;
  bool plan_dirty_ = false;
  std::string alert_;
  Then then_;
  bool http_inflight_ = false;
  uint32_t now_ms_ = 0;
  int64_t epoch_ = 0;
  int64_t last_minute_ = -1;
  std::vector<FetchRequest> outbox_;

  // secret gating
  enum class SecretMode : uint8_t { HIDDEN, ALLOWED, REFUSE } secret_mode_ = SecretMode::HIDDEN;
  bool secret_refused_ = false;
  std::string alert_pending_;
  bool background_failed_ = false;
};

}  // namespace rt
}  // namespace quire
