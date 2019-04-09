import { multipartEncode, multipartDecode } from "./message.js";

function isObject(obj) {
  return typeof obj === "object" && obj !== null;
}

function isEmptyObject(obj) {
  return Object.keys(obj).length === 0 && obj.constructor === Object;
}

const getFirstResult = result => result[0];

const MEDIATYPES = {
  DICOM: "application/dicom",
  DICOM_JSON: "application/dicom+json",
  OCTET_STREAM: "application/octet-stream",
  PDF: "application/pdf",
  JPEG: "image/jpeg",
  PNG: "image/png"
};

/**
 * Class for interacting with DICOMweb RESTful services.
 */
class DICOMwebClient {
  /**
   * @constructor
   * @param {Object} options (choices: "url", "username", "password", "headers")
   */
  constructor(options) {
    this.baseURL = options.url;
    if (!this.baseURL) {
      console.error("no DICOMweb base url provided - calls will fail");
    }

    if ("username" in options) {
      this.username = options.username;
      if (!("password" in options)) {
        console.error(
          "no password provided to authenticate with DICOMweb service"
        );
      }
      this.password = options.password;
    }

    if ("qidoURLPrefix" in options) {
      console.log(`use URL prefix for QIDO-RS: ${options.qidoURLPrefix}`);
      this.qidoURL = `${this.baseURL}/${options.qidoURLPrefix}`;
    } else {
      this.qidoURL = this.baseURL;
    }

    if ("wadoURLPrefix" in options) {
      console.log(`use URL prefix for WADO-RS: ${options.wadoURLPrefix}`);
      this.wadoURL = `${this.baseURL}/${options.wadoURLPrefix}`;
    } else {
      this.wadoURL = this.baseURL;
    }

    if ("stowURLPrefix" in options) {
      console.log(`use URL prefix for STOW-RS: ${options.stowURLPrefix}`);
      this.stowURL = `${this.baseURL}/${options.stowURLPrefix}`;
    } else {
      this.stowURL = this.baseURL;
    }

    this.headers = options.headers || {};
  }

  static _parseQueryParameters(params = {}) {
    let queryString = "?";
    Object.keys(params).forEach((key, index) => {
      if (index !== 0) {
        queryString += "&";
      }
      queryString += `${key}=${encodeURIComponent(params[key])}`;
    });
    return queryString;
  }

  _httpRequest(url, method, headers, options = {}) {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open(method, url, true);
      if ("responseType" in options) {
        request.responseType = options.responseType;
      }

      if (typeof headers === "object") {
        Object.keys(headers).forEach(key => {
          request.setRequestHeader(key, headers[key]);
        });
      }

      // now add custom headers from the user
      // (e.g. access tokens)
      const userHeaders = this.headers;
      Object.keys(userHeaders).forEach(key => {
        request.setRequestHeader(key, userHeaders[key]);
      });

      // Event triggered when upload starts
      request.onloadstart = function onloadstart(/* event */) {
        // console.log('upload started: ', url)
      };

      // Event triggered when upload ends
      request.onloadend = function onloadend(/* event */) {
        // console.log('upload finished')
      };

      // Handle response message
      request.onreadystatechange = function onreadystatechange(/* event */) {
        if (request.readyState === 4) {
          if (request.status === 200) {
            resolve(request.response);
          } else if (request.status === 202) {
            console.warn("some resources already existed: ", request);
            resolve(request.response);
          } else if (request.status === 204) {
            console.warn("empty response for request: ", request);
            resolve([]);
          } else {
            console.error("request failed: ", request);
            const error = new Error("request failed");
            error.request = request;
            error.response = request.response;
            error.status = request.status;
            console.error(error);
            console.error(error.response);

            reject(error);
          }
        }
      };

      // Event triggered while download progresses
      if ("progressCallback" in options) {
        if (typeof options.progressCallback === "function") {
          request.onprogress = options.progressCallback;
        }
      }

      // request.onprogress = function (event) {
      //   const loaded = progress.loaded;
      //   let total;
      //   let percentComplete;
      //   if (progress.lengthComputable) {
      //     total = progress.total;
      //     percentComplete = Math.round((loaded / total) * 100);
      //   j
      //   // console.log('download progress: ', percentComplete, ' %');
      //   return(percentComplete);
      // };

      if ("data" in options) {
        request.send(options.data);
      } else {
        request.send();
      }
    });
  }

  _httpGet(url, headers, responseType, progressCallback) {
    return this._httpRequest(url, "get", headers, {
      responseType,
      progressCallback
    });
  }

  _httpGetApplicationJson(url, params = {}, progressCallback) {
    let getUrl = url;

    if (typeof params === "object") {
      if (!isEmptyObject(params)) {
        getUrl += DICOMwebClient._parseQueryParameters(params);
      }
    }
    const headers = { Accept: MEDIATYPES.DICOM_JSON };
    const responseType = "json";
    return this._httpGet(getUrl, headers, responseType, progressCallback);
  }

  /**
   * Performs an HTTP GET request that accepts a message with
   "applicaton/pdf" media type.
   * @param {String} url
   * @param {Object[]} mediaTypes
   * @param {Object} params
   * @param {Function} progressCallback
   * @return {*}
   * @private
   */
  _httpGetApplicationPdf(url, params = {}, progressCallback) {
    let getUrl = url;

    if (typeof params === "object") {
      if (!isEmptyObject(params)) {
        getUrl += DICOMwebClient._parseQueryParameters(params);
      }
    }
    const headers = { Accept: MEDIATYPES.PDF };
    const responseType = "json";
    return this._httpGet(getUrl, headers, responseType, progressCallback);
  }

  /**
   * Performs an HTTP GET request that accepts a message with an image
   media type.
   *
   * @param {String} url
   * @param {Object[]} mediaTypes
   * @param {Object} params
   * @param {Function} progressCallback
   * @return {*}
   * @private
   */
  _httpGetImage(url, mediaTypes, params = {}, progressCallback) {
    let getUrl = url;

    if (typeof params === "object") {
      if (!isEmptyObject(params)) {
        getUrl += DICOMwebClient._parseQueryParameters(params);
      }
    }

    const supportedMediaTypes = [
      "image/",
      "image/*",
      "image/jpeg",
      "image/jp2",
      "image/gif",
      "image/png"
    ];

    const acceptHeaderFieldValue = DICOMwebClient._buildAcceptHeaderFieldValue(
      mediaTypes,
      supportedMediaTypes
    );
    const headers = { Accept: acceptHeaderFieldValue };
    const responseType = "arraybuffer";
    return this._httpGet(getUrl, headers, responseType, progressCallback);
  }

  /**
   * Performs an HTTP GET request that accepts a message with an image
   media type.
   *
   * @param {String} url
   * @param {Object[]} mediaTypes
   * @param {Object} params
   * @param {Function} progressCallback
   * @return {*}
   * @private
   */
  _httpGetText(url, mediaTypes, params = {}, progressCallback) {
    let getUrl = url;

    if (typeof params === "object") {
      if (!isEmptyObject(params)) {
        getUrl += DICOMwebClient._parseQueryParameters(params);
      }
    }

    const supportedMediaTypes = [
      "text/",
      "text/*",
      "text/html",
      "text/plain",
      "text/rtf",
      "text/xml"
    ];

    const acceptHeaderFieldValue = DICOMwebClient._buildAcceptHeaderFieldValue(
      mediaTypes,
      supportedMediaTypes
    );
    const headers = { Accept: acceptHeaderFieldValue };
    const responseType = "arraybuffer";
    return this._httpGet(getUrl, headers, responseType, progressCallback);
  }

  /**
   * Performs an HTTP GET request that accepts a message with a video
   media type.
   *
   * @param {String} url
   * @param {Object[]} mediaTypes
   * @param {Object} params
   * @param {Function} progressCallback
   * @return {*}
   * @private
   */
  _httpGetVideo(url, mediaTypes, params = {}, progressCallback) {
    let getUrl = url;

    if (typeof params === "object") {
      if (!isEmptyObject(params)) {
        getUrl += DICOMwebClient._parseQueryParameters(params);
      }
    }

    const supportedMediaTypes = [
      "video/",
      "video/*",
      "video/mpeg",
      "video/mp4",
      "video/H265"
    ];

    const acceptHeaderFieldValue = DICOMwebClient._buildAcceptHeaderFieldValue(
      mediaTypes,
      supportedMediaTypes
    );
    const headers = { Accept: acceptHeaderFieldValue };
    const responseType = "arraybuffer";
    return this._httpGet(getUrl, headers, responseType, progressCallback);
  }

  /**
   * Asserts that a given media type is valid.
   *
   * @params {String} mediaType media type
   */
  static _assertMediaTypeIsValid(mediaType) {
    if (!mediaType) {
      throw new Error(`Not a valid media type: ${mediaType}`);
    }

    const sepIndex = mediaType.indexOf("/");
    if (sepIndex === -1) {
      throw new Error(`Not a valid media type: ${mediaType}`);
    }

    const mediaTypeType = mediaType.slice(0, sepIndex);
    const types = ["application", "image", "text", "video"];
    if (!types.includes(mediaTypeType)) {
      throw new Error(`Not a valid media type: ${mediaType}`);
    }

    if (mediaType.slice(sepIndex + 1).includes("/")) {
      throw new Error(`Not a valid media type: ${mediaType}`);
    }
  }

  /**
   * Performs an HTTP GET request that accepts a multipart message with an image media type.
   *
   * @param {String} url unique resource locator
   * @param {Object[]} mediaTypes acceptable media types and optionally the UIDs of the
   corresponding transfer syntaxes
   * @param {Array} byteRange start and end of byte range
   * @param {Object} params additional HTTP GET query parameters
   * @param {Boolean} rendered whether resource should be requested using rendered media types
   * @param {Function} progressCallback
   * @private
   * @returns {Array} content of HTTP message body parts
   */
  _httpGetMultipartImage(
    url,
    mediaTypes,
    byteRange,
    params,
    rendered = false,
    progressCallback
  ) {
    const headers = {};
    let supportedMediaTypes;
    if (rendered) {
      supportedMediaTypes = [
        "image/jpeg",
        "image/gif",
        "image/png",
        "image/jp2"
      ];
    } else {
      supportedMediaTypes = {
        "1.2.840.10008.1.2.5": "image/x-dicom-rle",
        "1.2.840.10008.1.2.4.50": "image/jpeg",
        "1.2.840.10008.1.2.4.51": "image/jpeg",
        "1.2.840.10008.1.2.4.57": "image/jpeg",
        "1.2.840.10008.1.2.4.70": "image/jpeg",
        "1.2.840.10008.1.2.4.80": "image/x-jls",
        "1.2.840.10008.1.2.4.81": "image/x-jls",
        "1.2.840.10008.1.2.4.90": "image/jp2",
        "1.2.840.10008.1.2.4.91": "image/jp2",
        "1.2.840.10008.1.2.4.92": "image/jpx",
        "1.2.840.10008.1.2.4.93": "image/jpx"
      };
    }

    if (byteRange) {
      headers.Range = DICOMwebClient._buildRangeHeaderFieldValue(byteRange);
    }

    headers.Accept = DICOMwebClient._buildMultipartAcceptHeaderFieldValue(
      mediaTypes,
      supportedMediaTypes
    );

    return this._httpGet(url, headers, "arraybuffer", progressCallback).then(
      multipartDecode
    );
  }

  /**
   * Performs an HTTP GET request that accepts a multipart message with a video media type.
   *
   * @param {String} url unique resource locator
   * @param {Object[]} mediaTypes acceptable media types and optionally the UIDs of the
   corresponding transfer syntaxes
   * @param {Array} byteRange start and end of byte range
   * @param {Object} params additional HTTP GET query parameters
   * @param {Boolean} rendered whether resource should be requested using rendered media types
   * @param {Function} progressCallback
   * @private
   * @returns {Array} content of HTTP message body parts
   */
  _httpGetMultipartVideo(
    url,
    mediaTypes,
    byteRange,
    params,
    rendered = false,
    progressCallback
  ) {
    const headers = {};
    let supportedMediaTypes;
    if (rendered) {
      supportedMediaTypes = [
        "video/",
        "video/*",
        "video/mpeg2",
        "video/mp4",
        "video/H265"
      ];
    } else {
      supportedMediaTypes = {
        "1.2.840.10008.1.2.4.100": "video/mpeg2",
        "1.2.840.10008.1.2.4.101": "video/mpeg2",
        "1.2.840.10008.1.2.4.102": "video/mp4",
        "1.2.840.10008.1.2.4.103": "video/mp4",
        "1.2.840.10008.1.2.4.104": "video/mp4",
        "1.2.840.10008.1.2.4.105": "video/mp4",
        "1.2.840.10008.1.2.4.106": "video/mp4"
      };
    }

    if (byteRange) {
      headers.Range = DICOMwebClient._buildRangeHeaderFieldValue(byteRange);
    }

    headers.Accept = DICOMwebClient._buildMultipartAcceptHeaderFieldValue(
      mediaTypes,
      supportedMediaTypes
    );

    return this._httpGet(url, headers, "arraybuffer", progressCallback).then(
      multipartDecode
    );
  }

  /**
   * Performs a HTTP GET request that accepts a multipart message with "applicaton/dicom" media type
   *
   * @param {String} url unique resource locator
   * @param {Object[]} mediaTypes acceptable media types and optionally the UIDs of the
   corresponding transfer syntaxes
   * @param {Object} params additional HTTP GET query parameters
   * @param {Boolean} rendered whether resource should be requested using rendered media types
   * @private
   * @returns {Array} content of HTTP message body parts
   */
  _httpGetMultipartApplicationDicom(url, mediaTypes, params, progressCallback) {
    const headers = {};
    const defaultMediaType = "application/dicom";
    const supportedMediaTypes = {
      "1.2.840.10008.1.2.1": defaultMediaType,
      "1.2.840.10008.1.2.5": defaultMediaType,
      "1.2.840.10008.1.2.4.50": defaultMediaType,
      "1.2.840.10008.1.2.4.51": defaultMediaType,
      "1.2.840.10008.1.2.4.57": defaultMediaType,
      "1.2.840.10008.1.2.4.70": defaultMediaType,
      "1.2.840.10008.1.2.4.80": defaultMediaType,
      "1.2.840.10008.1.2.4.81": defaultMediaType,
      "1.2.840.10008.1.2.4.90": defaultMediaType,
      "1.2.840.10008.1.2.4.91": defaultMediaType,
      "1.2.840.10008.1.2.4.92": defaultMediaType,
      "1.2.840.10008.1.2.4.93": defaultMediaType,
      "1.2.840.10008.1.2.4.100": defaultMediaType,
      "1.2.840.10008.1.2.4.101": defaultMediaType,
      "1.2.840.10008.1.2.4.102": defaultMediaType,
      "1.2.840.10008.1.2.4.103": defaultMediaType,
      "1.2.840.10008.1.2.4.104": defaultMediaType,
      "1.2.840.10008.1.2.4.105": defaultMediaType,
      "1.2.840.10008.1.2.4.106": defaultMediaType
    };

    let acceptableMediaTypes = mediaTypes;
    if (!mediaTypes) {
      acceptableMediaTypes = [{ mediaType: defaultMediaType }];
    }

    headers.Accept = DICOMwebClient._buildMultipartAcceptHeaderFieldValue(
      acceptableMediaTypes,
      supportedMediaTypes
    );

    return this._httpGet(url, headers, "arraybuffer", progressCallback).then(
      multipartDecode
    );
  }

  /**
   * Performs a HTTP GET request that accepts a multipart message with "applicaton/dicom" media type
   *
   * @param {String} url unique resource locator
   * @param {Object[]} mediaTypes acceptable media types and optionally the UIDs of the
   corresponding transfer syntaxes
   * @param {Array} byteRange start and end of byte range
   * @param {Object} params additional HTTP GET query parameters
   * @private
   * @returns {Array} content of HTTP message body parts
   */
  _httpGetMultipartApplicationOctetStream(
    url,
    mediaTypes,
    byteRange,
    params,
    progressCallback
  ) {
    const headers = {};
    const defaultMediaType = "application/octet-stream";
    const supportedMediaTypes = {
      "1.2.840.10008.1.2.1": defaultMediaType
    };

    let acceptableMediaTypes = mediaTypes;
    if (!mediaTypes) {
      acceptableMediaTypes = [{ mediaType: defaultMediaType }];
    }

    if (byteRange) {
      headers.Range = DICOMwebClient._buildRangeHeaderFieldValue(byteRange);
    }

    headers.Accept = DICOMwebClient._buildMultipartAcceptHeaderFieldValue(
      acceptableMediaTypes,
      supportedMediaTypes
    );

    return this._httpGet(url, headers, "arraybuffer", progressCallback).then(
      multipartDecode
    );
  }

  _httpPost(url, headers, data, progressCallback) {
    return this._httpRequest(url, "post", headers, {
      data,
      progressCallback
    });
  }

  _httpPostApplicationJson(url, data, progressCallback) {
    const headers = { "Content-Type": MEDIATYPES.DICOM_JSON };
    return this._httpPost(url, headers, data, progressCallback);
  }

  /**
   * Parses media type and extracts its type and subtype.
   *
   * @param mediaType e.g. image/jpeg
   * @private
   */
  static _parseMediaType(mediaType) {
    DICOMwebClient._assertMediaTypeIsValid(mediaType);
    const { mediaTypeType, mediaTypeSubtype } = mediaType.split("/");

    return [mediaTypeType, mediaTypeSubtype];
  }

  /**
   * Builds an accept header field value for HTTP GET request messages.
   *
   * @param {Object[]} mediaTypes Acceptable media types
   * @param {Object[]} supportedMediaTypes Supported media types
   * @return {*}
   * @private
   */
  static _buildAcceptHeaderFieldValue(mediaTypes, supportedMediaTypes) {
    if (!Array.isArray(mediaTypes)) {
      throw new Error("Acceptable media types must be provided as an Array");
    }

    const fieldValueParts = mediaTypes.map(item => {
      const { transferSyntaxUID, mediaType } = item;

      DICOMwebClient._assertMediaTypeIsValid(mediaType);
      if (!supportedMediaTypes.includes(mediaType)) {
        throw new Error(
          `Media type ${mediaType} is not supported for requested resource`
        );
      }

      let acceptHeaderStringEntry = `type="${mediaType}"`;
      if (transferSyntaxUID) {
        acceptHeaderStringEntry += ` transfer-syntax: ${transferSyntaxUID}`;
      }

      return acceptHeaderStringEntry;
    });

    return fieldValueParts.join(", ");
  }

  /**
     * Builds an accept header field value for HTTP GET multipart request
     messages.
     *
     * @param {Object[]} mediaTypes Acceptable media types
     * @param {Object[]} supportedMediaTypes Supported media types
     * @private
     */
  static _buildMultipartAcceptHeaderFieldValue(
    mediaTypes,
    supportedMediaTypes
  ) {
    if (!Array.isArray(mediaTypes)) {
      throw new Error("Acceptable media types must be provided as an Array");
    }

    if (!Array.isArray(supportedMediaTypes) && !isObject(supportedMediaTypes)) {
      throw new Error(
        "Supported media types must be provided as an Array or an Object"
      );
    }

    const fieldValueParts = [];

    mediaTypes.forEach(item => {
      const { transferSyntaxUID, mediaType } = item;
      DICOMwebClient._assertMediaTypeIsValid(mediaType);
      let fieldValue = `multipart/related; type="${mediaType}"`;

      if (isObject(supportedMediaTypes)) {
        // SupportedMediaTypes is a lookup table from Transfer Syntax UID to Media Type

        if (!Object.values(supportedMediaTypes).includes(mediaType)) {
          if (!mediaType.endsWith("/*") || !mediaType.endsWith("/")) {
            throw new Error(
              `Media type ${mediaType} is not supported for requested resource`
            );
          }
        }

        if (transferSyntaxUID) {
          if (transferSyntaxUID !== "*") {
            if (!Object.keys(supportedMediaTypes).includes(transferSyntaxUID)) {
              throw new Error(
                `Transfer syntax ${transferSyntaxUID} is not supported for requested resource`
              );
            }

            const expectedMediaType = supportedMediaTypes[transferSyntaxUID];

            if (expectedMediaType !== mediaType) {
              const actualType = DICOMwebClient._parseMediaType(mediaType)[0];
              const expectedType = DICOMwebClient._parseMediaType(
                expectedMediaType
              )[0];
              const haveSameType = actualType === expectedType;

              if (
                haveSameType &&
                (mediaType.endsWith("/*") || mediaType.endsWith("/"))
              ) {
                return;
              }

              throw new Error(
                `Transfer syntax ${transferSyntaxUID} is not supported for requested resource`
              );
            }
          }

          fieldValue += `; transfer-syntax=${transferSyntaxUID}`;
        }
      } else if (
        Array.isArray(supportedMediaTypes) &&
        !supportedMediaTypes.includes(mediaType)
      ) {
        throw new Error(
          `Media type ${mediaType} is not supported for requested resource`
        );
      }

      fieldValueParts.push(fieldValue);
    });

    return fieldValueParts.join(", ");
  }

  /**
   * Builds a range header field value for HTTP GET request messages.
   *
   * @param {Array} byteRange start and end of byte range
   * @returns {String} range header field value
   */
  static _buildRangeHeaderFieldValue(byteRange = []) {
    if (byteRange.length === 1) {
      return `bytes=${byteRange[0]}-`;
    }
    if (byteRange.length === 2) {
      return `bytes=${byteRange[0]}-${byteRange[1]}`;
    }

    return "bytes=0-";
  }

  /**
   * Gets common type of acceptable media types and asserts that only
   one type is specified. For example, ``("image/jpeg", "image/jp2")``
   will pass, but ``("image/jpeg", "video/mpeg2")`` will raise an
   exception.
   * @param {String[]} acceptable media types and optionally the UIDs of the
   corresponding transfer syntaxes
   *
   */
  static _getCommonMediaType(mediaTypes) {
    if (!mediaTypes || !mediaTypes.length) {
      throw new Error("No acceptable media types provided");
    }

    const commonMediaTypes = new Set();
    mediaTypes.forEach(item => {
      const { mediaType } = item;

      if (mediaType.startsWith("application")) {
        commonMediaTypes.add(mediaType);
      } else {
        const { type } = DICOMwebClient._parseMediaType(mediaType);

        commonMediaTypes.add(`${type}/`);
      }
    });

    if (commonMediaTypes.size === 0) {
      throw new Error("No common acceptable media type could be identified.");
    } else if (commonMediaTypes.size > 1) {
      throw new Error("Acceptable media types must have the same type.");
    }

    return commonMediaTypes.entries()[0];
  }

  /**
   * Searches for DICOM studies.
   * @param {Object} options options object
   * @return {Array} study representations (http://dicom.nema.org/medical/dicom/current/output/chtml/part18/sect_6.7.html#table_6.7.1-2)
   */
  searchForStudies(options = {}) {
    console.log("search for studies");
    let url = `${this.qidoURL}/studies`;
    if ("queryParams" in options) {
      url += DICOMwebClient._parseQueryParameters(options.queryParams);
    }
    return this._httpGetApplicationJson(url);
  }

  /**
   * Retrieves metadata for a DICOM study.
   * @param {Object} options options object
   * @returns {Array} metadata elements in DICOM JSON format for each
   *                  instance belonging to the study
   */
  retrieveStudyMetadata(options) {
    if (!("studyInstanceUID" in options)) {
      throw new Error(
        "Study Instance UID is required for retrieval of study metadata"
      );
    }
    console.log(`retrieve metadata of study ${options.studyInstanceUID}`);
    const url = `${this.wadoURL}/studies/${options.studyInstanceUID}/metadata`;
    return this._httpGetApplicationJson(url);
  }

  /**
   * Searches for DICOM series.
   * @param {Object} options options object
   * @returns {Array} series representations (http://dicom.nema.org/medical/dicom/current/output/chtml/part18/sect_6.7.html#table_6.7.1-2a)
   */
  searchForSeries(options = {}) {
    let url = this.qidoURL;
    if ("studyInstanceUID" in options) {
      console.log(`search series of study ${options.studyInstanceUID}`);
      url += `/studies/${options.studyInstanceUID}`;
    }
    url += "/series";
    if ("queryParams" in options) {
      url += DICOMwebClient._parseQueryParameters(options.queryParams);
    }
    return this._httpGetApplicationJson(url);
  }

  /**
   * Retrieves metadata for a DICOM series.
   * @param {Object} options options object
   * @returns {Array} metadata elements in DICOM JSON format for each instance
   *                  belonging to the series
   */
  retrieveSeriesMetadata(options) {
    if (!("studyInstanceUID" in options)) {
      throw new Error(
        "Study Instance UID is required for retrieval of series metadata"
      );
    }
    if (!("seriesInstanceUID" in options)) {
      throw new Error(
        "Series Instance UID is required for retrieval of series metadata"
      );
    }

    console.log(`retrieve metadata of series ${options.seriesInstanceUID}`);
    const url = `${this.wadoURL}/studies/${options.studyInstanceUID}/series/${
      options.seriesInstanceUID
    }/metadata`;
    return this._httpGetApplicationJson(url);
  }

  /**
   * Searches for DICOM instances.
   * @param {Object} options options object
   * @returns {Array} instance representations (http://dicom.nema.org/medical/dicom/current/output/chtml/part18/sect_6.7.html#table_6.7.1-2b)
   */
  searchForInstances(options = {}) {
    let url = this.qidoURL;
    if ("studyInstanceUID" in options) {
      url += `/studies/${options.studyInstanceUID}`;
      if ("seriesInstanceUID" in options) {
        console.log(
          `search for instances of series ${options.seriesInstanceUID}`
        );
        url += `/series/${options.seriesInstanceUID}`;
      } else {
        console.log(
          `search for instances of study ${options.studyInstanceUID}`
        );
      }
    } else {
      console.log("search for instances");
    }
    url += "/instances";
    if ("queryParams" in options) {
      url += DICOMwebClient._parseQueryParameters(options.queryParams);
    }
    return this._httpGetApplicationJson(url);
  }

  /** Returns a WADO-URI URL for an instance
   * @param {Object} options options object
   * @returns {String} WADO-URI URL
   */
  buildInstanceWadoURIUrl(options) {
    if (!("studyInstanceUID" in options)) {
      throw new Error("Study Instance UID is required.");
    }
    if (!("seriesInstanceUID" in options)) {
      throw new Error("Series Instance UID is required.");
    }
    if (!("sopInstanceUID" in options)) {
      throw new Error("SOP Instance UID is required.");
    }

    const contentType = options.contentType || MEDIATYPES.DICOM;
    const transferSyntax = options.transferSyntax || "*";
    const params = [];

    params.push("requestType=WADO");
    params.push(`studyUID=${options.studyInstanceUID}`);
    params.push(`seriesUID=${options.seriesInstanceUID}`);
    params.push(`objectUID=${options.sopInstanceUID}`);
    params.push(`contentType=${contentType}`);
    params.push(`transferSyntax=${transferSyntax}`);

    const paramString = params.join("&");

    return `${this.wadoURL}?${paramString}`;
  }

  /**
   * Retrieves metadata for a DICOM instance.
   *
   * @param {Object} options object
   * @returns {Object} metadata elements in DICOM JSON format
   */
  retrieveInstanceMetadata(options) {
    if (!("studyInstanceUID" in options)) {
      throw new Error(
        "Study Instance UID is required for retrieval of instance metadata"
      );
    }
    if (!("seriesInstanceUID" in options)) {
      throw new Error(
        "Series Instance UID is required for retrieval of instance metadata"
      );
    }
    if (!("sopInstanceUID" in options)) {
      throw new Error(
        "SOP Instance UID is required for retrieval of instance metadata"
      );
    }
    console.log(`retrieve metadata of instance ${options.sopInstanceUID}`);
    const url = `${this.wadoURL}/studies/${options.studyInstanceUID}/series/${
      options.seriesInstanceUID
    }/instances/${options.sopInstanceUID}/metadata`;

    return this._httpGetApplicationJson(url);
  }

  /**
   * Retrieves frames for a DICOM instance.
   * @param {Object} options options object
   * @returns {Array} frame items as byte arrays of the pixel data element
   */
  retrieveInstanceFrames(options) {
    if (!("studyInstanceUID" in options)) {
      throw new Error(
        "Study Instance UID is required for retrieval of instance frames"
      );
    }
    if (!("seriesInstanceUID" in options)) {
      throw new Error(
        "Series Instance UID is required for retrieval of instance frames"
      );
    }
    if (!("sopInstanceUID" in options)) {
      throw new Error(
        "SOP Instance UID is required for retrieval of instance frames"
      );
    }
    if (!("frameNumbers" in options)) {
      throw new Error(
        "frame numbers are required for retrieval of instance frames"
      );
    }
    console.log(
      `retrieve frames ${options.frameNumbers.toString()} of instance ${
        options.sopInstanceUID
      }`
    );
    const url = `${this.wadoURL}/studies/${options.studyInstanceUID}/series/${
      options.seriesInstanceUID
    }/instances/${
      options.sopInstanceUID
    }/frames/${options.frameNumbers.toString()}`;

    const { mediaTypes } = options;

    if (!mediaTypes) {
      return this._httpGetMultipartApplicationOctetStream(url);
    }

    const commonMediaType = DICOMwebClient._getCommonMediaType(mediaTypes);

    if (commonMediaType === MEDIATYPES.OCTET_STREAM) {
      return this._httpGetMultipartApplicationOctetStream(url, mediaTypes);
    }
    if (commonMediaType.startsWith("image")) {
      return this._httpGetMultipartImage(url, mediaTypes);
    }
    if (commonMediaType.startsWith("video")) {
      return this._httpGetMultipartVideo(url, mediaTypes);
    }

    throw new Error(
      `Media type ${commonMediaType} is not supported for retrieval of frames.`
    );
  }

  /**
   * Retrieves an individual, server-side rendered DICOM instance.
   *
   * @param {Object} options options object
   * @returns {Array} frame items as byte arrays of the pixel data element
   */
  retrieveInstanceRendered(options) {
    if (!("studyInstanceUID" in options)) {
      throw new Error(
        "Study Instance UID is required for retrieval of rendered instance frames"
      );
    }
    if (!("seriesInstanceUID" in options)) {
      throw new Error(
        "Series Instance UID is required for retrieval of rendered instance frames"
      );
    }
    if (!("sopInstanceUID" in options)) {
      throw new Error(
        "SOP Instance UID is required for retrieval of rendered instance frames"
      );
    }

    const url = `${this.wadoURL}/studies/${options.studyInstanceUID}/series/${
      options.seriesInstanceUID
    }/instances/${options.sopInstanceUID}/rendered`;

    const { mediaTypes, params } = options;
    const headers = {};

    if (!mediaTypes) {
      const responseType = "arraybuffer";
      return this._httpGet(url, headers, responseType);
    }

    const commonMediaType = DICOMwebClient._getCommonMediaType(mediaTypes);
    if (commonMediaType.startsWith("image")) {
      return this._httpGetImage(url, mediaTypes, params);
    }
    if (commonMediaType.startsWith("video")) {
      return this._httpGetVideo(url, mediaTypes, params);
    }
    if (commonMediaType.startsWith("text")) {
      return this._httpGetText(url, mediaTypes, params);
    }
    if (commonMediaType === MEDIATYPES.PDF) {
      return this._httpGetApplicationPdf(url, params);
    }

    throw new Error(
      `Media type ${commonMediaType} is not supported for retrieval of rendered frame.`
    );
  }

  /**
   * Retrieves rendered frames for a DICOM instance.
   * @param {Object} options options object
   * @returns {Array} frame items as byte arrays of the pixel data element
   */
  retrieveInstanceFramesRendered(options) {
    if (!("studyInstanceUID" in options)) {
      throw new Error(
        "Study Instance UID is required for retrieval of rendered instance frames"
      );
    }
    if (!("seriesInstanceUID" in options)) {
      throw new Error(
        "Series Instance UID is required for retrieval of rendered instance frames"
      );
    }
    if (!("sopInstanceUID" in options)) {
      throw new Error(
        "SOP Instance UID is required for retrieval of rendered instance frames"
      );
    }
    if (!("frameNumbers" in options)) {
      throw new Error(
        "frame numbers are required for retrieval of rendered instance frames"
      );
    }

    const url = `${this.wadoURL}/studies/${options.studyInstanceUID}/series/${
      options.seriesInstanceUID
    }/instances/${
      options.sopInstanceUID
    }/frames/${options.frameNumbers.toString()}/rendered`;

    const { mediaTypes } = options;
    const headers = {};

    if (!mediaTypes) {
      const responseType = "arraybuffer";
      return this._httpGet(url, headers, responseType);
    }

    const commonMediaType = DICOMwebClient._getCommonMediaType(mediaTypes);
    if (commonMediaType.startsWith("image")) {
      return this._httpGetImage(url, mediaTypes);
    }
    if (commonMediaType.startsWith("video")) {
      return this._httpGetVideo(url, mediaTypes);
    }

    throw new Error(
      `Media type ${commonMediaType} is not supported for retrieval of rendered frame.`
    );
  }

  /**
   * Retrieves a DICOM instance.
   * @param {Object} options options object
   * @returns {Arraybuffer} DICOM Part 10 file as Arraybuffer
   */
  retrieveInstance(options) {
    if (!("studyInstanceUID" in options)) {
      throw new Error("Study Instance UID is required");
    }
    if (!("seriesInstanceUID" in options)) {
      throw new Error("Series Instance UID is required");
    }
    if (!("sopInstanceUID" in options)) {
      throw new Error("SOP Instance UID is required");
    }
    const url = `${this.wadoURL}/studies/${options.studyInstanceUID}/series/${
      options.seriesInstanceUID
    }/instances/${options.sopInstanceUID}`;

    const { mediaTypes } = options;

    if (!mediaTypes) {
      return this._httpGetMultipartApplicationDicom(url).then(getFirstResult);
    }

    const commonMediaType = DICOMwebClient._getCommonMediaType(mediaTypes);
    if (commonMediaType === MEDIATYPES.DICOM) {
      return this._httpGetMultipartApplicationDicom(url, mediaTypes).then(
        getFirstResult
      );
    }
    if (commonMediaType === MEDIATYPES.OCTET_STREAM) {
      return this._httpGetMultipartApplicationOctetStream(url, mediaTypes).then(
        getFirstResult
      );
    }
    if (commonMediaType.startsWith("image")) {
      // TODO: If length is >1, return all frames instead of using getFirstResult
      return this._httpGetMultipartImage(url, mediaTypes).then(getFirstResult);
    }
    if (commonMediaType.startsWith("video")) {
      // TODO: If length is >1, return all frames instead of using getFirstResult
      return this._httpGetMultipartVideo(url, mediaTypes).then(getFirstResult);
    }

    throw new Error(
      `Media type ${commonMediaType} is not supported for retrieval of instance.`
    );
  }

  /**
   * Retrieves a set of DICOM instance for a series.
   * @param {Object} options options object
   * @returns {Arraybuffer[]} Array of DICOM Part 10 files as Arraybuffers
   */
  retrieveSeries(options) {
    if (!("studyInstanceUID" in options)) {
      throw new Error("Study Instance UID is required");
    }
    if (!("seriesInstanceUID" in options)) {
      throw new Error("Series Instance UID is required");
    }
    const url = `${this.wadoURL}/studies/${options.studyInstanceUID}/series/${
      options.seriesInstanceUID
    }`;

    const { mediaTypes } = options;

    if (!mediaTypes) {
      return this._httpGetMultipartApplicationDicom(url);
    }

    const commonMediaType = DICOMwebClient._getCommonMediaType(mediaTypes);
    if (commonMediaType === MEDIATYPES.DICOM) {
      return this._httpGetMultipartApplicationDicom(url, mediaTypes);
    }
    if (commonMediaType === MEDIATYPES.OCTET_STREAM) {
      return this._httpGetMultipartApplicationOctetStream(url, mediaTypes);
    }
    if (commonMediaType.startsWith("image")) {
      return this._httpGetMultipartImage(url, mediaTypes);
    }
    if (commonMediaType.startsWith("video")) {
      return this._httpGetMultipartVideo(url, mediaTypes);
    }

    throw new Error(
      `Media type ${commonMediaType} is not supported for retrieval of series.`
    );
  }

  /**
   * Retrieves a set of DICOM instance for a study.
   * @param {Object} options options object
   * @returns {Arraybuffer[]} Array of DICOM Part 10 files as Arraybuffers
   */
  retrieveStudy(options) {
    if (!("studyInstanceUID" in options)) {
      throw new Error("Study Instance UID is required");
    }

    const url = `${this.wadoURL}/studies/${options.studyInstanceUID}`;

    const { mediaTypes } = options;

    if (!mediaTypes) {
      return this._httpGetMultipartApplicationDicom(url);
    }

    const commonMediaType = DICOMwebClient._getCommonMediaType(mediaTypes);
    if (commonMediaType === MEDIATYPES.DICOM) {
      return this._httpGetMultipartApplicationDicom(url, mediaTypes);
    }
    if (commonMediaType === MEDIATYPES.OCTET_STREAM) {
      return this._httpGetMultipartApplicationOctetStream(url, mediaTypes);
    }
    if (commonMediaType.startsWith("image")) {
      return this._httpGetMultipartImage(url, mediaTypes);
    }
    if (commonMediaType.startsWith("video")) {
      return this._httpGetMultipartVideo(url, mediaTypes);
    }

    throw new Error(
      `Media type ${commonMediaType} is not supported for retrieval of study.`
    );
  }

  /**
   * Retrieves and parses BulkData from a BulkDataURI location.
   * Decodes the multipart encoded data and returns the resulting data
   * as an ArrayBuffer.
   *
   * See http://dicom.nema.org/medical/dicom/current/output/chtml/part18/sect_6.5.5.html
   *
   * @param {Object} options options object
   * @return {Promise}
   */
  retrieveBulkData(options) {
    if (!("BulkDataURI" in options)) {
      throw new Error("BulkDataURI is required.");
    }

    const url = options.BulkDataURI;
    const { mediaTypes, byteRange } = options;

    if (!mediaTypes) {
      return this._httpGetMultipartApplicationOctetStream(
        url,
        mediaTypes,
        byteRange
      );
    }

    const commonMediaType = DICOMwebClient._getCommonMediaType(mediaTypes);
    if (commonMediaType === MEDIATYPES.OCTET_STREAM) {
      return this._httpGetMultipartApplicationOctetStream(
        url,
        mediaTypes,
        byteRange
      );
    }
    if (commonMediaType.startsWith("image")) {
      return this._httpGetMultipartImage(url, mediaTypes, byteRange);
    }

    throw new Error(
      `Media type ${commonMediaType} is not supported for retrieval of bulk data.`
    );
  }

  /**
   * Stores DICOM instances.
   *
   * @param {Object} options options object
   */
  storeInstances(options) {
    if (!("datasets" in options)) {
      throw new Error("datasets are required for storing");
    }

    let url = `${this.stowURL}/studies`;
    if ("studyInstanceUID" in options) {
      url += `/${options.studyInstanceUID}`;
    }

    const { data, boundary } = multipartEncode(options.datasets);
    const headers = {
      "Content-Type": `multipart/related; type=application/dicom; boundary=${boundary}`
    };

    return this._httpPost(url, headers, data, options.progressCallback);
  }
}

export { DICOMwebClient };
export default DICOMwebClient;
