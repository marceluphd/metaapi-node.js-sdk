'use strict';

import SynchronizationListener from '../clients/metaApi/synchronizationListener';
import moment from 'moment';
import Reservoir from './reservoir/reservoir';

/**
 * Tracks connection health status
 */
export default class ConnectionHealthMonitor extends SynchronizationListener {

  /**
   * Constructs the listener
   * @param {MetaApiConnection} connection MetaApi connection instance
   */
  constructor(connection) {
    super();
    this._connection = connection;
    setInterval(this._updateQuoteHealthStatus.bind(this), 1000);
    setInterval(this._measureUptime.bind(this), 1000);
    this._minQuoteInterval = 60000;
    this._uptimeReservoir = new Reservoir(24 * 7, 7 * 24 * 60 * 60 * 1000);
  }

  /**
   * Invoked when a symbol price was updated
   * @param {MetatraderSymbolPrice} price updated MetaTrader symbol price
   */
  onSymbolPriceUpdated(price) {
    try {
      let brokerTimestamp = moment(price.brokerTime).toDate().getTime();
      this._priceUpdatedAt = new Date();
      this._offset = this._priceUpdatedAt.getTime() - brokerTimestamp;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[' + (new Date()).toISOString() + '] failed to update quote streaming health status on price ' +
        'update for account ' + this._connection.account.id, err);
    }
  }

  /**
   * Connection health status
   * @typedef {Object} ConnectionHealthStatus
   * @property {Boolean} connected flag indicating successful connection to API server
   * @property {Boolean} connectedToBroker flag indicating successfull connection to broker
   * @property {Boolean} quoteStreamingHealthy flag indicating that quotes are being streamed successfully from the
   * broker
   * @property {Boolean} synchronized flag indicating a successful synchronization
   * @property {Boolean} healthy flag indicating overall connection health status
   * @property {String} message health status message
   */

  /**
   * Returns health status
   * @returns {ConnectionHealthStatus} connection health status
   */
  // eslint-disable-next-line complexity
  get healthStatus() {
    let status = {
      connected: this._connection.terminalState.connected,
      connectedToBroker: this._connection.terminalState.connectedToBroker,
      quoteStreamingHealthy: this._quotesHealthy,
      synchronized: this._connection.synchronized
    };
    status.healthy = status.connected && status.connectedToBroker && status.quoteStreamingHelathy &&
      status.synchronized;
    let message;
    if (status.healthy) {
      message = 'Connection to broker is stable. No health issues detected.';
    } else {
      message = 'Connection is not healthy because ';
      let reasons = [];
      if (!status.connected) {
        reasons.push('connection to API server is not established or lost');
      }
      if (!status.connectedToBroker) {
        reasons.push('connection to broker is not established or lost');
      }
      if (!status.synchronized) {
        reasons.push('local terminal state is not synchronized to broker');
      }
      if (!status.quoteStreamingHealthy) {
        reasons.push('quotes are not streamed from the broker properly');
      }
      message = message + reasons.join(' and ') + '.';
    }
    status.message = message;
    return status;
  }

  /**
   * Returns uptime in percents measured over a period of one week
   * @returns {number} uptime in percents measured over a period of one week
   */
  get uptime() {
    return this._uptimeReservoir.getStatistics().average;
  }

  _measureUptime() {
    try {
      this._uptimeReservoir.pushMeasurement(this._connection.terminalState.connected &&
        this._connection.terminalState.connectedToBroker && this._connection.synchronized &&
        this._quotesHealthy ? 100 : 0);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[' + (new Date()).toISOString() + '] failed to measure uptime for account ' +
        this._connection.account.id, err);
    }
  }

  // eslint-disable-next-line complexity
  _updateQuoteHealthStatus() {
    try {
      let serverDateTime = moment(new Date(Date.now() - this._offset));
      let serverTime = serverDateTime.format('HH:mm:ss.SSS');
      let dayOfWeek = serverDateTime.day();
      let daysOfWeek = {
        0: 'SUNDAY',
        1: 'MONDAY',
        2: 'TUESDAY',
        3: 'WEDNESDAY',
        4: 'THURSDAY',
        5: 'FRIDAY',
        6: 'SATURDAY'
      };
      let inQuoteSession = false;
      for (let symbol of this._connection.subscribedSymbols) {
        let specification = this._connection.terminalState.specification(symbol) || {};
        let quoteSessions = (specification.quoteSessions || [])[daysOfWeek[dayOfWeek]] || [];
        for (let session of quoteSessions) {
          if (session.from <= serverTime && session.to >= serverTime) {
            inQuoteSession = true;
          }
        }
      }
      this._quotesHealthy = !this._connection.subscribedSymbols.length || !inQuoteSession ||
        (Date.now() - this._priceUpdatedAt.getTime() < this._minQuoteInterval);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[' + (new Date()).toISOString() + '] failed to update quote streaming health status for account ' +
        this._connection.account.id, err);
    }
  }

}
