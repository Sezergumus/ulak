(() => {
  const DEFAULT_TAG = "v0.1.0-alpha";
  const REPO = "Sezergumus/ulak";

  const COPY = {
    en: {
      page_title: "Ulak — Direct Local-Network File Sharing for Windows",
      nav_tour: "How it works",
      nav_features: "Features",
      nav_devices: "Devices",
      nav_tech: "Under the hood",
      nav_download: "Download",
      hero_pill: "v0.1.0-alpha · Windows 10/11 · Offline LAN",
      hero_title_1: "Share Files Directly",
      hero_title_2: "Without The Cloud",
      hero_lead:
        "Send files and folders straight from your PC to nearby computers or phones on the same Wi-Fi. Nothing gets uploaded to the internet, and nothing gets copied twice.",
      hero_cta_primary: "Download for Windows",
      hero_cta_secondary: "See how it works",
      hero_meta:
        "Portable single .exe · No installer or account needed · MIT open source",
      float_pair_label: "Match on both screens",
      float_pair_badge: "Verified",
      float_pair_sub: "No IP addresses to type",
      float_dl_title: "Direct local stream",
      facts_title_1: "Built for everyday speed.",
      facts_title_2: "Zero setup headaches.",
      fact_1_label: "Cloud uploads, limits, or user accounts required",
      fact_2_label: "Compare one short number to pair nearby Windows PCs",
      fact_2_val: "6-Digit",
      fact_3_label: "Scan to open shared folders in any phone browser",
      fact_3_val: "1-Tap QR",
      fact_4_label:
        "Files stay in their original folder without duplicate copies",
      fact_4_val: "In-Place",
      tour_title_1: "Simple enough for everyone,",
      tour_title_2: "ready in seconds.",
      tour_subtitle:
        "Pick a file or drop a folder, choose who can open it, and let them download directly over your local Wi-Fi or cable.",
      tab_pair: "1. Pair PCs",
      tab_audience: "2. Pick audience",
      tab_guest: "3. Phone QR guest",
      tab_transfers: "4. Track & resume",
      tab_keyboard: "5. Quick search",
      zoom_label: "Click to inspect",
      bento_title_1: "Everything stays on your network,",
      bento_title_2: "under your control.",
      bento_subtitle:
        "Designed so anyone can share a 20 GB video or a quick PDF without touching settings they don't need.",
      b1_title: "You choose who sees every folder",
      b1_desc:
        "Keep a share private to a one-time link, pick specific paired computers (even when they are offline right now), or open it to everyone on your local Wi-Fi.",
      aud_1: "Invitation only",
      aud_1_tag: "Private link",
      aud_2: "Choose devices",
      aud_2_tag: "Studio-PC, Archive-Node",
      aud_3: "Everyone on the local network",
      aud_3_tag: "Read-only Wi-Fi",
      b2_title: "Send to any phone without an app",
      b2_desc:
        "Need to grab files on an iPhone, Android, or guest laptop? Generate a one-time QR code. They browse your shared folder straight in their browser.",
      b3_title: "No duplicate copies",
      b3_desc:
        "Sharing a huge folder doesn't copy it into an app vault or waste SSD space. Files stream directly from where they already live.",
      b3_badge: "In-place",
      b3_sub: "0 bytes duplicated on sender disk",
      b4_title: "Drag from and to Explorer",
      b4_desc:
        "Drop local folders into Ulak to share them immediately, or drag remote files right out of Ulak into any Windows Explorer folder.",
      b5_title: "Safe pause & resume",
      b5_desc:
        "Wi-Fi dropped halfway through a 10 GB file? Ulak saves your progress and checks every byte at the end so files never arrive corrupted.",
      b5_badge: "Verified",
      b6_title: "Runs quietly in your system tray",
      b6_desc:
        "Close the window and Ulak keeps sharing in the background. Press one shortcut anytime from anywhere to bring it right back up.",
      kbd_summon: "Summon Ulak",
      kbd_cmd: "Command menu",
      kbd_filter: "Filter list",
      b7_title: "Recognizes your PC even when IP changes",
      b7_desc:
        "Switched from Wi-Fi to Ethernet cable? Ulak remembers each paired computer by its own identity—not a temporary router address.",
      orbit_title_1: "Every device,",
      orbit_title_2: "effortlessly connected.",
      orbit_subtitle:
        "Pair once, then browse permitted folders whenever both computers are on the same network—no repeated approval popups.",
      o1_title: "Automatic discovery",
      o1_desc: "Nearby Ulak PCs appear on the radar automatically over mDNS.",
      o2_title: "Encrypted by default",
      o2_desc:
        "Every transfer runs over local HTTPS with verified device trust.",
      o3_title: "Offline-ready grants",
      o3_desc:
        "Share with a paired PC while it sleeps; it pulls files when it wakes.",
      o4_title: "Browser guest links",
      o4_desc:
        "Single-use QR codes expire in 5 minutes; sessions revoke anytime.",
      o5_title: "Whole-folder pulls",
      o5_desc:
        "Download full nested folders natively without waiting for a ZIP.",
      o6_title: "Built-in local CLI",
      o6_desc:
        "Script shares and downloads via the running desktop's named pipe.",
      orbit_bar_left: "Nearby Radar",
      tech_eyebrow: "Under the hood · For engineers",
      tech_title_1: "Rust core, strict bounds,",
      tech_title_2: "verifiable by design.",
      tech_lead:
        "For those curious about how it works beneath the UI: Ulak separates an authoritative Rust core from its Tauri v2 Windows shell and React 19 interface.",
      t1_title: "Bounded 64 KiB streaming & locked handles",
      t1_desc:
        "Files stream straight from Windows handles (denying concurrent writes/deletion) using fixed <code>64 KiB</code> buffers—never buffered into RAM or passed through WebView JSON.",
      t2_title: "Ed25519 identity & commit-before-reveal pairing",
      t2_desc:
        "Device IDs are <code>BLAKE3</code> hashes of persistent Ed25519 keys. Nearby 6-digit pairing binds descriptors and 256-bit nonces via signed commitments before reveal over pinned local CA TLS (<code>rustls</code> + <code>rcgen</code>).",
      t3_title: "Crash-safe resume & lazy Explorer COM streams",
      t3_desc:
        "Native downloads persist flushed byte offsets in <code>.part</code> files, validate <code>ETag</code> revisions and HTTP ranges, and verify complete <code>BLAKE3</code> digests. Explorer drag-out serves lazy range-backed <code>IDataObject</code>/<code>IStream</code> streams with <code>XChaCha20-Poly1305</code> opaque entry IDs.",
      link_protocol: "Protocol spec (protocol.md)",
      link_arch: "Architecture contract",
      link_status: "Validation status",
      ttab_arch: "Architecture",
      ttab_bounds: "Runtime bounds",
      ttab_cli: "Local CLI",
      c_core:
        "Ed25519/BLAKE3 identity, local CA TLS, mDNS, pairing, opaque catalog, streaming transfers",
      c_local: "Current-user SID named-pipe IPC & secret-free snapshot codec",
      c_cli:
        "Product `ulak` CLI talking to the live desktop without taking the state lock",
      c_drag:
        "Shared Windows OLE virtual-file COM stream (`IDataObject` / `IStream`)",
      c_ui: "Tauri v2 Windows tray shell + React 19 / Zustand keyboard-first UI",
      c_guest:
        "Locally bundled HTML/JS browser interface with zero external requests",
      b_buf: "Fixed streaming & hash I/O buffer",
      b_conc: "Max served streams / downloads / hash jobs",
      b_page: "Directory listing cap · 120s cursor TTL",
      b_replay: "Signed request clock skew & replay cache",
      b_guest: "Invite expiry · max guest session (30m idle)",
      b_state: "Capped metadata records & state ceiling",
      copy_btn: "Copy",
      copied_btn: "Copied",
      dl_title_1: "Ready to share files",
      dl_title_2: "the direct way?",
      dl_subtitle:
        "Download the portable Windows desktop app and run it right away—no installer, no background cloud service, no sign-up.",
      dl_exe: "Download ulak-desktop.exe",
      dl_zip: "Portable .zip (Desktop + CLI)",
      dl_all: "GitHub Releases",
      note_smartscreen_title: "First-launch SmartScreen note",
      note_smartscreen_body:
        "Because this pre-release binary is unsigned, Windows may show a SmartScreen prompt on first launch. Choose More info → Run anyway, or build directly from source on GitHub.",
      note_scope_title: "Early alpha release scope",
      note_scope_body:
        "Core Rust, WebView, and localhost workflows pass automated checks; real second-PC Wi-Fi, mobile Safari/Chrome certificate onboarding, interactive Explorer drag-out, and 50 GB stress validation are ongoing.",
      footer_tagline:
        "Offline, zero-staging local-network file sharing for Windows PCs and browser guests. Open source under the MIT license.",
      footer_col_product: "Product",
      footer_col_eng: "Engineering",
      footer_col_repo: "Project",
      footer_proto: "Protocol v1",
      footer_arch: "Architecture",
      footer_license: "MIT License",
      zoom_devices:
        "Devices overview — paired PCs, nearby radar, quick shares, and live transfer bar",
      zoom_guest_browser:
        "Offline browser guest view — browse folders and download files from any device",
      zoom_remote:
        "Remote browser — multi-select files, download folders, or drag into Windows Explorer",
      zoom_shares:
        "My shares & details — inspect source paths, audiences, and guest invitations",
      zoom_radar:
        "Nearby radar — mDNS discovery finds local Ulak computers automatically",
      orbit_radar_head: "Nearby Radar",
      chip_browse: "Browse",
      chip_pair: "Pair",
      chip_phone: "Guest Phone",
      chip_offline: "Offline",
      radar_detail_studio: "Paired · Online · Ready to browse",
      radar_detail_thinkpad: "Found on Wi-Fi · Pair with 6-digit code",
      radar_detail_phone: "Browser guest · 5-min one-time QR session",
      radar_detail_archive: "Paired · Offline · Last seen 3 hours ago",
    },
    tr: {
      page_title: "Ulak — Windows İçin Doğrudan Yerel Ağ Dosya Paylaşımı",
      nav_tour: "Nasıl Çalışır",
      nav_features: "Özellikler",
      nav_devices: "Cihazlar",
      nav_tech: "Teknik Detaylar",
      nav_download: "İndir",
      hero_pill: "v0.1.0-alpha · Windows 10/11 · İnternetsiz Yerel Ağ",
      hero_title_1: "Dosyalarını Doğrudan Paylaş,",
      hero_title_2: "Bulut Olmadan.",
      hero_lead:
        "Bilgisayarındaki dosya ve klasörleri aynı Wi-Fi veya kablo ağındaki başka bir bilgisayara ya da telefona doğrudan aktar. İnternete yükleme yok, diske ikinci bir kopya çıkarma yok.",
      hero_cta_primary: "Windows İçin İndir",
      hero_cta_secondary: "Nasıl çalıştığını gör",
      hero_meta: "Kurulumsuz tek .exe · Hesap gerektirmez · MIT açık kaynak",
      float_pair_label: "İki ekranda eşleştir",
      float_pair_badge: "Doğrulandı",
      float_pair_sub: "IP adresi yazmaya gerek yok",
      float_dl_title: "Doğrudan yerel aktarım",
      facts_title_1: "Günlük kullanım için sade.",
      facts_title_2: "Karmaşık ayar yok.",
      fact_1_label: "Buluta yükleme, kota sınırı veya üyelik zorunluluğu",
      fact_2_label: "Yakındaki iki bilgisayarı eşleştirmek için kısa bir kod",
      fact_2_val: "6 Haneli",
      fact_3_label: "Telefon tarayıcısından klasör açmak için tek seferlik kod",
      fact_3_val: "Anında QR",
      fact_4_label: "Dosyalar ikinci kez kopyalanmadan kendi klasöründen akar",
      fact_4_val: "Yerinde",
      tour_title_1: "Herkesin anlayacağı kadar sade,",
      tour_title_2: "saniyeler içinde hazır.",
      tour_subtitle:
        "Bir dosya seç ya da klasörü sürükle bırak, kimin görebileceğini seç; karşı taraf kendi hızında doğrudan indirsin.",
      tab_pair: "1. Eşleştir",
      tab_audience: "2. Kim görsün?",
      tab_guest: "3. Telefona QR",
      tab_transfers: "4. Takip & Devam",
      tab_keyboard: "5. Hızlı arama",
      zoom_label: "Büyütmek için tıkla",
      bento_title_1: "Her şey kendi ağında kalır,",
      bento_title_2: "kontrol sende olur.",
      bento_subtitle:
        "Teknik ayarlarla uğraşmadan 20 GB’lık bir videoyu ya da tek bir belgeyi güvenle paylaşman için tasarlandı.",
      b1_title: "Her klasörü kimin göreceğini sen seçersin",
      b1_desc:
        "İstersen tek kullanımlık davetle gizli tut, istersen yalnızca seçtiğin cihazlara aç (o an kapalı olsalar bile), istersen aynı ağdaki herkese görünür yap.",
      aud_1: "Yalnızca davet ile",
      aud_1_tag: "Tek seferlik link",
      aud_2: "Cihazları seç",
      aud_2_tag: "Studio-PC, Archive-Node",
      aud_3: "Yerel ağdaki herkes",
      aud_3_tag: "Salt okunur Wi-Fi",
      b2_title: "Uygulama kurmadan telefona gönder",
      b2_desc:
        "iPhone, Android veya misafir bir bilgisayara dosya mı atacaksın? Tek kullanımlık QR kodu okut; klasör doğrudan tarayıcıda açılsın.",
      b3_title: "Diskte fazladan kopya yok",
      b3_desc:
        "Dev bir klasörü paylaştığında uygulama onu başka bir yere kopyalamaz veya ZIP yapmaz. Dosyalar durduğu yerden doğrudan karşıya akar.",
      b3_badge: "Yerinde",
      b3_sub: "Gönderici diskinde 0 bayt ek kopya",
      b4_title: "Explorer’dan at, Explorer’a çek",
      b4_desc:
        "Paylaşmak istediğin klasörü pencereye sürükle bırak. Karşıdaki dosyaları da indirme bitmeden doğrudan Windows klasörüne sürükleyip al.",
      b5_title: "Kesilse de kaldığı yerden devam",
      b5_desc:
        "10 GB’lık indirme yarıda Wi-Fi kopmasıyla kesilirse endişelenme. Kaldığı bayttan devam eder ve bitişte dosyanın sağlamlığını kontrol eder.",
      b5_badge: "Doğrulandı",
      b6_title: "Sistem tepsisinde sessizce çalışır",
      b6_desc:
        "Pencereyi kapatsan da paylaşımlar arka planda sürer. İstediğin an tek kısayolla Ulak’ı anında ekrana çağırabilirsin.",
      kbd_summon: "Ulak’ı getir",
      kbd_cmd: "Komut menüsü",
      kbd_filter: "Listeyi filtrele",
      b7_title: "IP değişse de bilgisayarını tanır",
      b7_desc:
        "Wi-Fi’dan Ethernet kablosuna mı geçtin? Ulak eşleşen cihazları geçici modem IP’siyle değil, kalıcı cihaz kimliğiyle hatırlar.",
      orbit_title_1: "Tüm cihazların,",
      orbit_title_2: "zahmetsizce bağlı.",
      orbit_subtitle:
        "Bir kez eşleştir; iki bilgisayar aynı ağda buluştuğunda her seferinde onay penceresi açmadan izinli klasörlere ulaş.",
      o1_title: "Otomatik keşif",
      o1_desc:
        "Aynı ağdaki Ulak bilgisayarları mDNS ile radarda kendiliğinden görünür.",
      o2_title: "Varsayılan şifreli",
      o2_desc:
        "Tüm aktarımlar doğrulanmış cihaz güveniyle yerel HTTPS üzerinden akar.",
      o3_title: "Çevrimdışı izinler",
      o3_desc:
        "Eşleşmiş bilgisayar uyurken paylaşım ver; açıldığında gelip kendi indirsin.",
      o4_title: "Tarayıcı misafir linki",
      o4_desc:
        "Tek kullanımlık QR kod 5 dakikada süresini doldurur; oturumu anında iptal et.",
      o5_title: "Tam klasör indirme",
      o5_desc: "İç içe klasörleri ZIP beklemeye gerek kalmadan doğrudan indir.",
      o6_title: "Yerleşik yerel CLI",
      o6_desc: "Çalışan uygulamayı named pipe üzerinden komut satırıyla yönet.",
      orbit_bar_left: "Yakın Radar",
      tech_eyebrow: "Perde arkası · Meraklısı ve geliştiriciler için",
      tech_title_1: "Rust çekirdek, sınırlı bellek,",
      tech_title_2: "uçtan uca doğrulanabilir.",
      tech_lead:
        "Arayüzün altında neler döndüğünü merak edenler için: Ulak yetkili Rust çekirdeğini Tauri v2 Windows kabuğu ve React 19 arayüzünden temiz biçimde ayırır.",
      t1_title: "Sabit 64 KiB akış & kilitli kaynak tutamaçları",
      t1_desc:
        "Dosyalar eşzamanlı yazma/silmeye kapalı Windows dosya tutamaçlarından sabit <code>64 KiB</code> tamponlarla akar; RAM’de biriktirilmez veya WebView JSON’undan geçmez.",
      t2_title: "Ed25519 kimlik & commit-before-reveal eşleşme",
      t2_desc:
        "Cihaz kimlikleri kalıcı Ed25519 anahtarlarının <code>BLAKE3</code> özetidir. Yakın 6 haneli eşleşme, sabitlenmiş yerel CA TLS (<code>rustls</code> + <code>rcgen</code>) üzerinde 256-bit nonce taahhüdüyle bağlanır.",
      t3_title: "Çökme güvenli devam & tembel Explorer COM akışları",
      t3_desc:
        "İndirmeler diske yazılmış bayt konumunu <code>.part</code> kayıtlarında tutar, <code>ETag</code> ve HTTP range doğrular, bitişte tam <code>BLAKE3</code> özeti kontrol eder. Explorer’a sürükleme <code>XChaCha20-Poly1305</code> opak kimlikli tembel <code>IDataObject</code>/<code>IStream</code> akışı sunar.",
      link_protocol: "Protokol şartnamesi (protocol.md)",
      link_arch: "Mimari sözleşme (context.md)",
      link_status: "Doğrulama durumu",
      ttab_arch: "Mimari",
      ttab_bounds: "Çalışma sınırları",
      ttab_cli: "Yerel CLI",
      c_core:
        "Ed25519/BLAKE3 kimlik, yerel CA TLS, mDNS, eşleşme, opak katalog ve akış motoru",
      c_local:
        "Geçerli kullanıcı SID’sine kilitli named-pipe IPC ve gizli verisiz anlık görüntü",
      c_cli:
        "State kilidini almadan çalışan masaüstüyle konuşan `ulak` komut aracı",
      c_drag:
        "Paylaşımlı Windows OLE sanal dosya COM akışı (`IDataObject` / `IStream`)",
      c_ui: "Tauri v2 Windows sistem tepsisi kabuğu + React 19 / Zustand klavye odaklı arayüz",
      c_guest:
        "Dış ağ isteği yapmayan, tamamen yerel gömülü HTML/JS misafir arayüzü",
      b_buf: "Sabit akış ve özet G/Ç tamponu",
      b_conc: "Maks. eşzamanlı yayın / indirme / hash işi",
      b_page: "Klasör listeleme limiti · 120 sn imleç ömrü",
      b_replay: "İmzalı istek saat toleransı ve replay önbelleği",
      b_guest: "Davet ömrü · maks. misafir oturumu (30 dk boşta)",
      b_state: "Üst metadata kayıt ve durum dosyası sınırı",
      copy_btn: "Kopyala",
      copied_btn: "Kopyalandı",
      dl_title_1: "Dosyalarını doğrudan paylaşmaya",
      dl_title_2: "hazır mısın?",
      dl_subtitle:
        "Kurulum gerektirmeyen taşınabilir Windows uygulamasını indirip hemen çalıştır. Arka planda bulut servisi veya üyelik yok.",
      dl_exe: "ulak-desktop.exe İndir",
      dl_zip: "Taşınabilir .zip (Masaüstü + CLI)",
      dl_all: "GitHub Sürümleri",
      note_smartscreen_title: "İlk açılış SmartScreen uyarısı",
      note_smartscreen_body:
        "Bu erken sürüm kod imzasız olduğu için Windows ilk açılışta SmartScreen uyarısı gösterebilir. Ek bilgi → Yine de çalıştır seçebilir veya GitHub üzerinden kaynaktan derleyebilirsin.",
      note_scope_title: "Erken alfa sürüm kapsamı",
      note_scope_body:
        "Rust çekirdeği, WebView ve yerel testler otomatik doğrulamalardan geçmiştir; ikinci fiziksel PC Wi-Fi, mobil Safari/Chrome sertifika kurulumu, gerçek Explorer sürükle-bırak ve 50 GB stres testleri devam etmektedir.",
      footer_tagline:
        "Windows bilgisayarlar ve tarayıcı misafirleri için çevrimdışı, kopyasız yerel ağ dosya paylaşımı. MIT lisansı ile açık kaynak.",
      footer_col_product: "Ürün",
      footer_col_eng: "Mühendislik",
      footer_col_repo: "Proje",
      footer_proto: "Protokol v1",
      footer_arch: "Mimari",
      footer_license: "MIT Lisansı",
      zoom_devices:
        "Cihazlar görünümü — eşleşen bilgisayarlar, yakın radar, hızlı paylaşımlar ve aktarım çubuğu",
      zoom_guest_browser:
        "Çevrimdışı tarayıcı misafir arayüzü — uygulama kurmadan klasör gez ve indir",
      zoom_remote:
        "Uzak dosya tarayıcısı — çoklu seçim, klasör indirme veya Explorer’a sürükleme",
      zoom_shares:
        "Paylaşımlarım ve detaylar — kaynak yolları, erişim izinleri ve misafir davetleri",
      zoom_radar:
        "Yakın radar — mDNS keşfi yerel ağdaki Ulak bilgisayarlarını otomatik bulur",
      orbit_radar_head: "Yakın Radar",
      chip_browse: "Göz at",
      chip_pair: "Eşleştir",
      chip_phone: "Misafir Telefon",
      chip_offline: "Çevrimdışı",
      radar_detail_studio: "Eşleşti · Çevrimiçi · Dosyalar gezilebilir",
      radar_detail_thinkpad: "Wi-Fi’da bulundu · 6 haneli kodla eşleştir",
      radar_detail_phone: "Tarayıcı misafiri · 5 dk tek seferlik QR",
      radar_detail_archive: "Eşleşti · Çevrimdışı · Son görülme 3 saat önce",
    },
  };

  const TOUR_STEPS = {
    pair: {
      img: "./images/numeric-pairing.png",
      alt_en:
        "Six-digit numeric comparison dialog for pairing two Ulak computers",
      alt_tr:
        "İki Ulak bilgisayarını eşleştirmek için 6 haneli sayı karşılaştırma penceresi",
      title_en: "Compare a 6-digit number and connect",
      title_tr: "6 haneli sayıyı karşılaştır ve bağlan",
      desc_en:
        "Ulak discovers nearby computers automatically. Check that the same 6-digit number appears on both screens and click Match and pair.",
      desc_tr:
        "Ulak yakındaki bilgisayarları otomatik bulur. İki ekranda aynı 6 haneli sayının göründüğünü doğrulayıp Eşleştir’e basman yeterli.",
      pills_en: ["Automatic nearby radar", "No IP typing"],
      pills_tr: ["Otomatik yakın radar", "IP yazmak yok"],
    },
    audience: {
      img: "./images/audience-picker.png",
      alt_en:
        "Who can access dialog with Invitation only, Choose devices, and Everyone on the local network",
      alt_tr:
        "Kim erişebilir seçim penceresi: Yalnızca davet, Cihaz seçimi ve Yerel ağdaki herkes",
      title_en: "Decide exactly who can see each folder",
      title_tr: "Her klasörü kimin göreceğini net biçimde seç",
      desc_en:
        "Grant access to one-time invitations, specific paired computers (even if offline right now), or everyone on your local Wi-Fi.",
      desc_tr:
        "Tek kullanımlık davetle sınırla, belirli eşleşmiş bilgisayarları seç (o an kapalı olsalar bile) ya da yerel ağdaki herkese aç.",
      pills_en: ["Offline device grants", "Instant revocation"],
      pills_tr: ["Çevrimdışı cihaza izin", "Anında erişim kesme"],
    },
    guest: {
      img: "./images/guest-qr.png",
      alt_en:
        "Share with a browser guest dialog displaying QR code and single-use invitation link",
      alt_tr:
        "Tarayıcı misafiri için QR kod ve tek seferlik bağlantı penceresi",
      title_en: "Share to any phone or tablet via QR",
      title_tr: "QR kod ile herhangi bir telefona gönder",
      desc_en:
        "Create a one-time QR code for any share. Guests scan it and download directly from their phone browser—no app installation needed.",
      desc_tr:
        "İstediğin paylaşım için tek seferlik QR kod üret. Misafirler telefon kamerasıyla okutup uygulama kurmadan tarayıcıdan indirsin.",
      pills_en: ["5-min one-time invite", "Zero external requests"],
      pills_tr: ["5 dk tek kullanımlık davet", "Dış internete çıkmaz"],
    },
    transfers: {
      img: "./images/transfers.png",
      alt_en:
        "Transfers view showing live download progress, BLAKE3 file checking, and completed state",
      alt_tr:
        "Canlı indirme ilerlemesi, BLAKE3 dosya doğrulama ve tamamlandı durumlarını gösteren Aktarımlar ekranı",
      title_en: "Live speed, automatic check, safe resume",
      title_tr: "Canlı hız, otomatik kontrol, güvenli devam",
      desc_en:
        "Watch downloads stream in real time. Interrupted transfers resume from saved progress, and every file is verified before finishing.",
      desc_tr:
        "İndirmeleri anlık izle. Yarıda kalan aktarımlar kaldığı yerden devam eder ve her dosya bitişte sağlamlık kontrolünden geçer.",
      pills_en: ["BLAKE3 integrity check", "Never overwrites files"],
      pills_tr: ["BLAKE3 bütünlük kontrolü", "Üzerine yazmaz"],
    },
    keyboard: {
      img: "./images/command-menu.png",
      alt_en:
        "Ulak Ctrl+K command menu showing grouped actions, devices, and keyboard shortcuts",
      alt_tr:
        "Cihazları, paylaşımları ve eylemleri listeleyen Ctrl+K komut menüsü",
      title_en: "Jump anywhere without touching the mouse",
      title_tr: "Fareye dokunmadan her yere anında ulaş",
      desc_en:
        "Summon Ulak from any app with Ctrl+Alt+U, search devices or folders with Ctrl+K, and filter long lists in place with Ctrl+F.",
      desc_tr:
        "Hangi uygulamada olursan ol Ctrl+Alt+U ile pencereyi çağır, Ctrl+K ile cihaz veya klasör ara, Ctrl+F ile listeyi süz.",
      pills_en: ["Ctrl+Alt+U global summon", "Ctrl+K command menu"],
      pills_tr: ["Ctrl+Alt+U her yerden aç", "Ctrl+K komut menüsü"],
    },
  };

  let currentLang = "en";
  let currentTour = "pair";
  let tourTimer = null;
  let lastFocused = null;

  function detectInitialLang() {
    try {
      const saved = localStorage.getItem("ulak-lang");
      if (saved === "tr" || saved === "en") return saved;
    } catch {
      // Ignore storage failures in restricted contexts
    }
    return navigator.language &&
      navigator.language.toLowerCase().startsWith("tr")
      ? "tr"
      : "en";
  }

  function applyLang(lang) {
    currentLang = lang === "tr" ? "tr" : "en";
    document.documentElement.lang = currentLang;

    const dict = COPY[currentLang];
    document.title = dict.page_title;

    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (!key || !(key in dict)) return;
      if (el.closest(".tech-point") || el.tagName === "P") {
        el.innerHTML = dict[key];
      } else {
        el.textContent = dict[key];
      }
    });

    const switcher = document.getElementById("lang-switch");
    if (switcher) {
      switcher.setAttribute("data-lang", currentLang);
      switcher.querySelectorAll(".lang-btn").forEach((btn) => {
        btn.setAttribute(
          "aria-pressed",
          btn.getAttribute("data-set-lang") === currentLang ? "true" : "false",
        );
      });
    }

    renderTourStep(currentTour, false);

    const activeRadar = document.querySelector("[data-radar-device].is-active");
    const statusName = document.getElementById("radar-status-name");
    if (activeRadar && statusName) {
      const chipName = activeRadar.querySelector(".chip-name");
      if (chipName) statusName.textContent = chipName.textContent;
    }

    try {
      localStorage.setItem("ulak-lang", currentLang);
    } catch {
      // Ignore storage failures
    }
  }

  function renderTourStep(stepKey, animate) {
    const step = TOUR_STEPS[stepKey];
    if (!step) return;
    currentTour = stepKey;

    const frame = document.getElementById("tour-frame");
    const img = document.getElementById("tour-image");
    const zoomBtn = document.getElementById("tour-zoom-btn");
    const titleEl = document.getElementById("tour-caption-title");
    const descEl = document.getElementById("tour-caption-desc");
    const pillsEl = document.getElementById("tour-pills");

    document.querySelectorAll(".tour-tab").forEach((tab) => {
      const active = tab.getAttribute("data-tour") === stepKey;
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });

    const title = currentLang === "tr" ? step.title_tr : step.title_en;
    const desc = currentLang === "tr" ? step.desc_tr : step.desc_en;
    const alt = currentLang === "tr" ? step.alt_tr : step.alt_en;
    const pills = currentLang === "tr" ? step.pills_tr : step.pills_en;

    const applyContent = () => {
      if (img) {
        img.src = step.img;
        img.alt = alt;
      }
      if (zoomBtn) {
        zoomBtn.setAttribute("data-zoom-src", step.img);
        zoomBtn.setAttribute("data-zoom-caption", `${title} — ${desc}`);
      }
      if (titleEl) titleEl.textContent = title;
      if (descEl) descEl.textContent = desc;
      if (pillsEl) {
        pillsEl.innerHTML = "";
        pills.forEach((label) => {
          const span = document.createElement("span");
          span.className = "mini-pill";
          span.textContent = label;
          pillsEl.appendChild(span);
        });
      }
    };

    if (
      !animate ||
      !frame ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      applyContent();
      return;
    }

    if (tourTimer) {
      window.clearTimeout(tourTimer);
      tourTimer = null;
    }
    frame.classList.add("is-switching");
    tourTimer = window.setTimeout(() => {
      applyContent();
      frame.classList.remove("is-switching");
      tourTimer = null;
    }, 115);
  }

  function bindTabs(selector, onSelect) {
    const tabs = Array.from(document.querySelectorAll(selector));
    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => onSelect(tab));
      tab.addEventListener("keydown", (event) => {
        let next = -1;
        if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
        else if (event.key === "ArrowLeft")
          next = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = tabs.length - 1;
        if (next === -1) return;
        event.preventDefault();
        tabs[next].focus();
        onSelect(tabs[next]);
      });
    });
  }

  function openLightbox(src, caption, alt) {
    const lightbox = document.getElementById("lightbox");
    const img = document.getElementById("lightbox-img");
    const cap = document.getElementById("lightbox-caption");
    const closeBtn = document.getElementById("lightbox-close");
    if (!lightbox || !img || !cap) return;

    lastFocused = document.activeElement;
    img.src = src;
    img.alt = alt || caption || "";
    cap.textContent = caption || "";
    lightbox.hidden = false;
    window.requestAnimationFrame(() => {
      lightbox.setAttribute("data-open", "true");
      closeBtn?.focus();
    });
  }

  function closeLightbox() {
    const lightbox = document.getElementById("lightbox");
    if (!lightbox || lightbox.hidden) return;
    lightbox.setAttribute("data-open", "false");
    window.setTimeout(() => {
      lightbox.hidden = true;
      if (lastFocused && typeof lastFocused.focus === "function") {
        lastFocused.focus();
      }
    }, 180);
  }

  async function refreshReleaseInfo() {
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 3500);
      const res = await fetch(
        `https://api.github.com/repos/${REPO}/releases?per_page=1`,
        {
          signal: controller.signal,
        },
      );
      window.clearTimeout(timer);
      if (!res.ok) return;
      const releases = await res.json();
      const latest = Array.isArray(releases) ? releases[0] : null;
      if (!latest || !latest.tag_name) return;

      const tag = latest.tag_name;
      const assets = Array.isArray(latest.assets) ? latest.assets : [];
      const exeAsset = assets.find((a) => a.name && a.name.endsWith(".exe"));
      const zipAsset = assets.find((a) => a.name && a.name.endsWith(".zip"));

      const labelEl = document.getElementById("release-tag-label");
      if (labelEl) labelEl.textContent = `${tag} · Windows x64`;

      if (exeAsset?.browser_download_url) {
        document.querySelectorAll("[data-release-exe]").forEach((a) => {
          a.setAttribute("href", exeAsset.browser_download_url);
        });
      }
      if (zipAsset?.browser_download_url) {
        document.querySelectorAll("[data-release-zip]").forEach((a) => {
          a.setAttribute("href", zipAsset.browser_download_url);
        });
      }
    } catch {
      // Keep static fallback URLs targeting v0.1.0-alpha
    }
  }

  function init() {
    // Sticky header scroll state
    const topbar = document.getElementById("topbar");
    const syncScroll = () => {
      if (!topbar) return;
      topbar.setAttribute(
        "data-scrolled",
        window.scrollY > 14 ? "true" : "false",
      );
    };
    syncScroll();
    window.addEventListener("scroll", syncScroll, { passive: true });

    // Language toggle
    document.querySelectorAll("[data-set-lang]").forEach((btn) => {
      btn.addEventListener("click", () => {
        applyLang(btn.getAttribute("data-set-lang") || "en");
      });
    });

    // Visual tour tabs
    bindTabs(".tour-tab", (tab) => {
      const key = tab.getAttribute("data-tour");
      if (key && key !== currentTour) renderTourStep(key, true);
    });

    // Interactive radar device chips
    const radarDevices = {
      studio: { name: () => "Studio-PC", key: "radar_detail_studio" },
      thinkpad: { name: () => "ThinkPad-X1", key: "radar_detail_thinkpad" },
      phone: {
        name: () => COPY[currentLang].chip_phone,
        key: "radar_detail_phone",
      },
      archive: { name: () => "Archive-Node", key: "radar_detail_archive" },
    };
    const radarChips = document.querySelectorAll("[data-radar-device]");
    const radarStatusName = document.getElementById("radar-status-name");
    const radarStatusDetail = document.getElementById("radar-status-detail");
    radarChips.forEach((chip) => {
      chip.addEventListener("click", () => {
        const id = chip.getAttribute("data-radar-device");
        const info = id && radarDevices[id];
        if (!info) return;
        radarChips.forEach((c) => {
          const active = c === chip;
          c.classList.toggle("is-active", active);
          c.setAttribute("aria-pressed", active ? "true" : "false");
        });
        if (radarStatusName) radarStatusName.textContent = info.name();
        if (radarStatusDetail) {
          radarStatusDetail.setAttribute("data-i18n", info.key);
          radarStatusDetail.textContent = COPY[currentLang][info.key];
        }
      });
    });

    // Technical console tabs
    bindTabs(".tech-tab", (tab) => {
      const target = tab.getAttribute("data-tech-tab");
      document.querySelectorAll(".tech-tab").forEach((t) => {
        t.setAttribute("aria-selected", t === tab ? "true" : "false");
      });
      document.querySelectorAll(".tech-pane").forEach((pane) => {
        pane.hidden = pane.getAttribute("data-tech-pane") !== target;
      });
    });

    // CLI copy button
    const copyBtn = document.getElementById("copy-cli");
    const cliSnippet = document.getElementById("cli-snippet");
    if (copyBtn && cliSnippet) {
      let copyReset = null;
      copyBtn.addEventListener("click", async () => {
        const text = cliSnippet.textContent || "";
        try {
          await navigator.clipboard.writeText(text.trim());
          copyBtn.setAttribute("data-copied", "true");
          const label = copyBtn.querySelector("span");
          if (label) label.textContent = COPY[currentLang].copied_btn;
          if (copyReset) window.clearTimeout(copyReset);
          copyReset = window.setTimeout(() => {
            copyBtn.removeAttribute("data-copied");
            if (label) label.textContent = COPY[currentLang].copy_btn;
          }, 1600);
        } catch {
          // Clipboard access may be blocked on non-HTTPS origins
        }
      });
    }

    // Lightbox triggers
    document.querySelectorAll(".zoomable").forEach((el) => {
      el.addEventListener("click", () => {
        const src = el.getAttribute("data-zoom-src");
        if (!src) return;
        const capKey = el.getAttribute("data-zoom-caption-key");
        const directCap = el.getAttribute("data-zoom-caption");
        const caption = capKey ? COPY[currentLang][capKey] : directCap || "";
        const img = el.querySelector("img");
        openLightbox(src, caption, img?.alt || caption);
      });
    });

    const lightbox = document.getElementById("lightbox");
    const closeBtn = document.getElementById("lightbox-close");
    closeBtn?.addEventListener("click", closeLightbox);
    lightbox?.addEventListener("click", (event) => {
      if (event.target === lightbox) closeLightbox();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeLightbox();
    });

    // Apply initial language & silently check GitHub for latest release assets
    applyLang(detectInitialLang());
    if (DEFAULT_TAG) void refreshReleaseInfo();
  }

  init();
})();
