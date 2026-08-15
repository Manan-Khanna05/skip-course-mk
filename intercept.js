(function () {
    // 1. Save references to original networking features
    const originalFetch = window.fetch;
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;
    const originalXHRSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

    // 2. Setup the bridge to talk to content.js
    class InterceptBus {
        send(url, contentType, responseData, requestData) {
            window.postMessage({
                source: "auto-coursera-interceptor",
                url: url,
                contentType: contentType,
                response: responseData,
                request: requestData
            }, "*");
        }
    }
    const messageBus = new InterceptBus();

    // 3. Patch window.fetch
    window.fetch = async function (resource, initParams) {
        try {
            // Let the request pass normally
            const response = await originalFetch.apply(this, arguments);

            // Clone and parse what we can without breaking things
            const responseClone = response.clone();
            const url = responseClone.url;
            const contentType = responseClone.headers.get("content-type") || "";

            let responseBody;
            if (contentType.includes("application/json")) {
                try {
                    responseBody = await responseClone.json();
                } catch (e) {
                    console.error("Error parsing intercepted JSON", e);
                }
            }

            // Capture request tokens & headers.
            // Headers can live either on the init params or on a Request object
            // passed as the first argument, so check both.
            let headerPairs = [];
            try {
                if (initParams && initParams.headers) {
                    headerPairs = Array.from(new Headers(initParams.headers).entries());
                } else if (typeof Request !== "undefined" && resource instanceof Request) {
                    headerPairs = Array.from(resource.headers.entries());
                }
            } catch (e) { }

            const requestData = {
                url: url,
                method: initParams?.method || "GET",
                headers: headerPairs,
                body: initParams?.body,
                status: responseClone.status,
                statusText: responseClone.statusText
            };

            // Send captured data to content.js
            messageBus.send(url, contentType, responseBody, requestData);

            return response;
        } catch (error) {
            console.error("Fetch intercept error:", error);
            throw error;
        }
    };

    // 4. Patch XMLHttpRequest
    XMLHttpRequest.prototype.open = function (method, url) {
        this._interceptUrl = url;
        this._interceptMethod = method;
        // Array of [name, value] pairs, matching the shape used for fetch
        this._interceptHeaders = [];

        return originalXHROpen.apply(this, arguments);
    };

    // Without this, _interceptHeaders stays empty and the CSRF token is never
    // seen on XHR requests
    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
        if (!this._interceptHeaders) this._interceptHeaders = [];
        this._interceptHeaders.push([name, value]);

        return originalXHRSetRequestHeader.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function (body) {
        this.addEventListener('load', function () {
            const url = this.responseURL || this._interceptUrl;
            const contentType = this.getResponseHeader('content-type') || "";
            let responseData;
            
            if (contentType.includes("application/json")) {
                try {
                    responseData = JSON.parse(this.responseText);
                } catch(e) {}
            }

            const requestData = {
                url: url,
                method: this._interceptMethod,
                headers: this._interceptHeaders, 
                body: body,
                status: this.status,
                statusText: this.statusText
            };

            messageBus.send(url, contentType, responseData, requestData);
        });

        return originalXHRSend.apply(this, arguments);
    };
    
    // Add an alert so we visually know this script injected properly during testing
    console.log("✅ AutoCoursera Interceptor Successfully Attached!");
})();
