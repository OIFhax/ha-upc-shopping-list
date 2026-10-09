const CARD_VERSION = "1.0.0";
const CARD_TAG = "upc-shopping-list-card";
const DUPLICATE_WINDOW_MS = 3000;

const DEFAULT_CONFIG = Object.freeze({
  entity: "todo.shopping_list",
  catalog_entity: "todo.upc_lookup_catalog",
  script: "script.upc_lookup_add_item",
  list_name: "Shopping List",
  country_code: "us",
  language_code: "en",
});

class UpcShoppingListCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._rendered = false;
    this._busy = false;
    this._scanActive = false;
    this._capabilityShown = false;
    this._lastBarcode = "";
    this._lastScanAt = 0;
  }

  setConfig(config) {
    this._config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
    this._updateCapability();
  }

  getCardSize() {
    return 2;
  }

  connectedCallback() {
    this._render();
  }

  disconnectedCallback() {
    if (this._scanActive) {
      this._finishScan(true);
    }
  }

  _render() {
    if (this._rendered || !this._config) return;
    this._rendered = true;
    this.shadowRoot.innerHTML = `
      <style>
        ha-card {
          background: var(--ha-card-background, var(--card-background-color));
          color: var(--primary-text-color);
          padding: 16px;
          overflow: hidden;
        }
        .actions {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 52px;
          gap: 8px;
        }
        button {
          border: 0;
          cursor: pointer;
          font: inherit;
        }
        #scan {
          align-items: center;
          background: var(--primary-color);
          border-radius: var(--ha-card-border-radius, 12px);
          color: var(--text-primary-color, #fff);
          display: flex;
          font-weight: 600;
          gap: 10px;
          justify-content: center;
          min-height: 52px;
          padding: 8px 18px;
        }
        #manual-toggle {
          align-items: center;
          background: var(--secondary-background-color);
          border-radius: var(--ha-card-border-radius, 12px);
          color: var(--primary-text-color);
          display: flex;
          justify-content: center;
        }
        button:disabled {
          cursor: wait;
          filter: grayscale(.7);
          opacity: .65;
        }
        #manual {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 8px;
          margin-top: 10px;
        }
        #manual[hidden] {
          display: none;
        }
        input {
          background: var(--input-fill-color, var(--secondary-background-color));
          border: 1px solid var(--divider-color);
          border-radius: var(--ha-card-border-radius, 12px);
          box-sizing: border-box;
          color: var(--primary-text-color);
          font: inherit;
          min-width: 0;
          padding: 10px 14px;
        }
        #lookup {
          background: var(--primary-color);
          border-radius: var(--ha-card-border-radius, 12px);
          color: var(--text-primary-color, #fff);
          font-weight: 600;
          padding: 0 16px;
        }
        #status {
          color: var(--secondary-text-color);
          font-size: .86em;
          min-height: 1.25em;
          padding: 8px 4px 0;
        }
        #status[data-kind="success"] { color: var(--success-color, #43a047); }
        #status[data-kind="error"] { color: var(--error-color, #db4437); }
      </style>
      <ha-card>
        <div class="actions">
          <button id="scan" type="button">
            <ha-icon icon="mdi:barcode-scan"></ha-icon>
            <span>Scan Item</span>
          </button>
          <button id="manual-toggle" type="button" title="Enter a barcode manually">
            <ha-icon icon="mdi:keyboard"></ha-icon>
          </button>
        </div>
        <div id="manual" hidden>
          <input id="barcode" inputmode="numeric" autocomplete="off" placeholder="UPC / EAN" />
          <button id="lookup" type="button">Look Up</button>
        </div>
        <div id="status" aria-live="polite">Ready</div>
      </ha-card>
    `;

    this._scanButton = this.shadowRoot.querySelector("#scan");
    this._manualToggle = this.shadowRoot.querySelector("#manual-toggle");
    this._manualPanel = this.shadowRoot.querySelector("#manual");
    this._barcodeInput = this.shadowRoot.querySelector("#barcode");
    this._lookupButton = this.shadowRoot.querySelector("#lookup");
    this._status = this.shadowRoot.querySelector("#status");

    this._scanButton.addEventListener("click", () => this._startScan());
    this._manualToggle.addEventListener("click", () => this._showManualEntry());
    this._lookupButton.addEventListener("click", () => this._submitManualBarcode());
    this._barcodeInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") this._submitManualBarcode();
    });
  }

  _updateCapability() {
    if (!this._rendered || !this._hass || this._busy || this._capabilityShown) return;
    this._capabilityShown = true;
    this._setStatus(
      this._hasNativeScanner()
        ? "Ready for Companion app barcode scanning"
        : "Native scanner unavailable; use manual barcode entry",
    );
  }

  _hasNativeScanner() {
    return Boolean(
      this._hass?.auth?.external?.config?.hasBarCodeScanner
      && typeof window.externalBus === "function",
    );
  }

  _startScan() {
    if (this._busy || this._scanActive) return;
    if (!this._hasNativeScanner()) {
      this._showManualEntry();
      return;
    }
    if (!this._installExternalBus()) {
      this._showManualEntry();
      return;
    }
    this._scanActive = true;
    this._scanButton.disabled = true;
    this._setStatus("Opening barcode scanner…");
    try {
      this._hass.auth.external.fireMessage({
        type: "bar_code/scan",
        payload: {
          title: `${this._config.list_name} Scanner`,
          description: "Scan the UPC or EAN barcode on an item",
          alternative_option_label: "Enter barcode manually",
        },
      });
    } catch (error) {
      console.error("Could not open the native barcode scanner", error);
      this._finishScan(false);
      this._showManualEntry();
      this._setStatus("Scanner could not open; enter the barcode manually", "error");
    }
  }

  _installExternalBus() {
    if (this._externalBusWrapper) return true;
    const original = window.externalBus;
    if (typeof original !== "function") return false;
    this._originalExternalBus = original;
    this._externalBusWrapper = (incoming) => {
      try {
        return original.call(window, incoming);
      } finally {
        this._handleExternalMessage(incoming);
      }
    };
    window.externalBus = this._externalBusWrapper;
    return true;
  }

  _restoreExternalBus() {
    if (
      this._externalBusWrapper
      && window.externalBus === this._externalBusWrapper
      && this._originalExternalBus
    ) {
      window.externalBus = this._originalExternalBus;
    }
    this._externalBusWrapper = undefined;
    this._originalExternalBus = undefined;
  }

  _handleExternalMessage(incoming) {
    let message = incoming;
    if (typeof message === "string") {
      try {
        message = JSON.parse(message);
      } catch (_error) {
        return;
      }
    }
    if (message?.type === "externalBus") message = message.payload;

    if (message?.command === "bar_code/scan_result") {
      const { rawValue, format } = message.payload ?? {};
      if (!this._normalizeBarcode(rawValue)) {
        try {
          this._hass.auth.external.fireMessage({
            type: "bar_code/notify",
            payload: { message: "That is not a valid UPC/EAN. Try again." },
          });
          this._setStatus("Invalid barcode; scanner is ready to try again", "error");
        } catch (error) {
          console.error("Could not notify the native barcode scanner", error);
          this._finishScan(true);
          this._showManualEntry();
          this._setStatus("That barcode is not valid; try again or enter it manually", "error");
        }
        return;
      }
      this._finishScan(true);
      void this._processBarcode(rawValue, format);
    } else if (message?.command === "bar_code/aborted") {
      const manual = message.payload?.reason === "alternative_options";
      this._finishScan(false);
      if (manual) this._showManualEntry();
      else this._setStatus("Scan canceled");
    }
  }

  _finishScan(sendClose) {
    try {
      if (sendClose) {
        this._hass?.auth?.external?.fireMessage?.({ type: "bar_code/close" });
      }
    } catch (error) {
      console.warn("Could not close the native barcode scanner cleanly", error);
    } finally {
      this._scanActive = false;
      this._restoreExternalBus();
      if (this._rendered) this._setBusy(false);
    }
  }

  _normalizeBarcode(rawValue) {
    const rawText = String(rawValue ?? "").trim();
    const barcode = rawText.replace(/[\s-]/g, "");
    if (!/^[0-9\s-]+$/.test(rawText) || ![8, 12, 13, 14].includes(barcode.length)) {
      return "";
    }
    return barcode;
  }

  _showManualEntry() {
    this._manualPanel.hidden = false;
    this._setStatus("Enter a UPC or EAN barcode");
    setTimeout(() => this._barcodeInput.focus(), 0);
  }

  _submitManualBarcode() {
    const barcode = this._barcodeInput.value;
    void this._processBarcode(barcode, "manual");
  }

  async _processBarcode(rawValue, _format) {
    const barcode = this._normalizeBarcode(rawValue);
    if (!barcode) {
      this._setBusy(false);
      this._showManualEntry();
      this._setStatus("That barcode is not a valid UPC/EAN", "error");
      return;
    }

    const now = Date.now();
    if (barcode === this._lastBarcode && now - this._lastScanAt < DUPLICATE_WINDOW_MS) {
      this._setStatus("Duplicate scan ignored");
      return;
    }
    this._lastBarcode = barcode;
    this._lastScanAt = now;
    this._setBusy(true);
    this._setStatus(`Looking up ${barcode}…`);

    try {
      const result = await this._callBarcodeService(barcode);
      const succeeded = result.success === true || result.success === "true";

      if (succeeded && result.name) {
        this._barcodeInput.value = "";
        this._setStatus(`Added ${result.name} to ${this._config.list_name}`, "success");
        this._haptic("success");
      } else {
        await this._requestManualName(barcode, result.reason);
      }
    } catch (error) {
      console.error("UPC product lookup failed", error);
      this._setStatus("Product lookup failed; enter the item manually", "error");
      await this._requestManualName(barcode, "lookup_error");
    } finally {
      this._setBusy(false);
    }
  }

  async _callBarcodeService(barcode, extraData = {}) {
    const service = this._config.script.replace(/^script\./, "");
    const response = await this._hass.callWS({
      type: "call_service",
      domain: "script",
      service,
      service_data: {
        barcode,
        submitted_name: extraData.submitted_name ?? "",
        entity: this._config.entity,
        catalog_entity: this._config.catalog_entity,
        list_name: this._config.list_name,
        country_code: this._config.country_code,
        language_code: this._config.language_code,
      },
      return_response: true,
    });
    return response?.response ?? response?.service_response ?? response ?? {};
  }

  async _requestManualName(barcode, reason) {
    const reasonText = reason === "rate_limited"
      ? "The product service is busy."
      : "No product name was found.";
    const name = window.prompt(`${reasonText}\nEnter a name for barcode ${barcode}:`, "");
    if (!name?.trim()) {
      this._setStatus("Item was not added");
      return;
    }
    try {
      const result = await this._callBarcodeService(barcode, {
        submitted_name: name.trim(),
      });
      const succeeded = result.success === true || result.success === "true";
      if (!succeeded || !result.name) {
        throw new Error(`Server did not save product ${barcode}`);
      }
      this._barcodeInput.value = "";
      this._setStatus(`Learned and added ${result.name} to ${this._config.list_name}`, "success");
      this._haptic("success");
    } catch (error) {
      console.error("Could not save learned UPC product", error);
      this._setStatus("Could not save the product; please try again", "error");
      this._haptic("failure");
    }
  }

  _haptic(hapticType) {
    this._hass?.auth?.external?.fireMessage?.({
      type: "haptic",
      payload: { hapticType },
    });
  }

  _setBusy(busy) {
    this._busy = busy;
    this._scanButton.disabled = busy;
    this._manualToggle.disabled = busy;
    this._lookupButton.disabled = busy;
    this._barcodeInput.disabled = busy;
  }

  _setStatus(message, kind = "") {
    if (!this._status) return;
    this._status.textContent = message;
    this._status.dataset.kind = kind;
  }
}

function registerCard() {
  const registry = window.customElements;
  if (!registry.get(CARD_TAG)) {
    try {
      registry.define(CARD_TAG, UpcShoppingListCard);
    } catch (error) {
      if (!registry.get(CARD_TAG)) {
        console.error(`Could not register ${CARD_TAG}`, error);
      }
    }
  }

  window.customCards = window.customCards || [];
  if (!window.customCards.some((card) => card.type === CARD_TAG)) {
    window.customCards.push({
      type: CARD_TAG,
      name: "UPC Shopping List",
      description: "Scan UPC/EAN codes and add resolved products to a Home Assistant shopping list.",
    });
  }
}

// Home Assistant 2026.8+ can replace the native CustomElementRegistry after
// resources start loading. Register immediately and again once the frontend is
// ready so Companion app cold starts do not show "Configuration error".
registerCard();
window.customElements.whenDefined("home-assistant").then(registerCard);
setTimeout(registerCard, 1000);

console.info(`UPC Shopping List ${CARD_VERSION} loaded`);
