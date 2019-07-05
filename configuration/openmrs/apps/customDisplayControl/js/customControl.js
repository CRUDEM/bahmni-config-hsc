'use strict';

/*
 * Entity that represents an approved or non approved invoice or order fetched from the ERP
 */
class BillingLine {
  constructor(id, date, visit, document, order, tags, displayName) {
    this.id = id;
    this.date = date;
    if (visit == null) {
      this.visit = {
        uuid: null,
        startDate: date,
        endDate: null
      }
    } else {
      this.visit = visit;
    }
    this.document = document;
    this.order = order;
    this.tags = tags;
    this.displayName = displayName;
  }
};

angular.module('bahmni.common.displaycontrol.custom')

  .service('erpService', ['$http', '$httpParamSerializer', 'sessionService', function($http, $httpParamSerializer, sessionService) {

    this.getOrder = function(id, representation) {
      var order = $http.get(Bahmni.Common.Constants.openmrsUrl + "/ws/rest/v1/erp/order/" + id + "?" + $httpParamSerializer({
        rep: representation
      }), {});
      return order;
    };

    this.getAllOrders = function(filters, representation) {
      var orders = $http.post(Bahmni.Common.Constants.openmrsUrl + "/ws/rest/v1/erp/order?" + $httpParamSerializer({
        rep: representation
      }), {
        filters: filters
      });
      return orders;
    };

    this.getInvoice = function(id, representation) {
      var invoice = $http.get(Bahmni.Common.Constants.openmrsUrl + "/ws/rest/v1/erp/invoice/" + id + "?" + $httpParamSerializer({
        rep: representation
      }), {});
      return invoice;
    };

    this.getAllInvoices = function(filters, representation) {
      var salesInvoiceFilter = {
        "field": "type",
        "comparison": "=",
        "value": "out_invoice"
      }
      filters.push(salesInvoiceFilter)
      var invoices = $http.post(Bahmni.Common.Constants.openmrsUrl + "/ws/rest/v1/erp/invoice?" + $httpParamSerializer({
        rep: representation
      }), {
        filters: filters
      });
      return invoices;
    };

  }]);
angular.module('bahmni.common.displaycontrol.custom')
  .service('openMRSVisitService', ['$http', '$httpParamSerializer', 'sessionService', function($http, $httpParamSerializer, sessionService) {

    this.getVisits = function(patientUuid, representation) {
      var visits = $http.get(Bahmni.Common.Constants.openmrsUrl + "/ws/rest/v1/visit?" + $httpParamSerializer({
        v: representation,
        patient: patientUuid
      }), {});
      return visits;
    }
  }]);

angular.module('bahmni.common.displaycontrol.custom')
  .directive('billingStatus', ['erpService', 'openMRSVisitService', 'appService', 'spinner', '$q', function(erpService, visitService, appService, spinner, $q) {
    var controller = function($scope) {
      $scope.contentUrl = appService.configBaseUrl() + "/customDisplayControl/views/billingStatus.html";

      const ORDER = "ORDER"
      const INVOICE = "INVOICE"

      const NON_INVOICED = "NON INVOICED"
      const FULLY_INVOICED = "FULLY_INVOICED"
      const PARTIALLY_INVOICED = "PARTIALLY_INVOICED"

      const PAID = "PAID"
      const NOT_PAID = "NOT_PAID"

      const OVERDUE = "OVERDUE"
      const NOT_OVERDUE = "NOT_OVERDUE"

      const retireLinesConditions = $scope.config.retireLinesConditions
      const nonApprovedConditions = $scope.config.nonApprovedConditions
      const approvedConditions = $scope.config.approvedConditions

      // Temporary filter to work on non-Bahmni Odoo installs.
      // TODO: replace with '"field": "partner_uuid"' and '"value": $scope.patient.uuid'
      const patientFilter = {
        "field": "partner_id",
        "comparison": "=",
        "value": "8"
      }
      // Initialize the filters with the patient filter.
      var invoicesFilters = [patientFilter];
      var ordersFilters = [patientFilter];

      var invoices = [];
      var orders = [];
      var visits = [];

      var lines = [];
      $scope.lines = [];

      const erpOrderRepresentation = [
        "order_lines",
        "date",
        "date_order",
        "name",
        "number",
        "x_external_order_id"
      ]

      var retrieveErpOrders = function() {
        return erpService.getAllOrders(ordersFilters, "custom:" + erpOrderRepresentation.toString()).then(function(response) {
          orders = response.data;
        })
      }

      const erpInvoiceRepresentation = [
        "invoice_lines",
        "date",
        "state",
        "date_due",
        "number"
      ]

      var retrieveErpInvoices = function() {
        return erpService.getAllInvoices(invoicesFilters, "custom:" + erpInvoiceRepresentation.toString()).then(function(response) {
          invoices = response.data;
        })
      }

      var getOrdersAndInvoices = function() {
        return $q.all([retrieveErpOrders(), retrieveErpInvoices()]).then(function() {
          setTagsToOrderLines(orders);
          setTagsToInvoiceLines(invoices);
          setApprovalStatusToLines();
          removeRetired();
        });
      }

      var getAllVisitsWithOrders = function() {
        const customRepresentation = Bahmni.ConceptSet.CustomRepresentationBuilder.build(['uuid', 'startDatetime', 'stopDatetime', 'encounters:(orders:(uuid))']);
        return visitService.getVisits($scope.patient.uuid, "custom:" + customRepresentation).then(function(response) {
          var flat = [];
          response.data.results.forEach(function(visit) {
            visit.encounters.forEach(function(encounter) {
              encounter.orders.forEach(function(order) {
                flat.push({
                  uuid: visit.uuid,
                  order: order.uuid,
                  startDate: visit.startDatetime,
                  endDate: visit.startDatetime
                })
              })
            })
          });
          visits = flat;
        })
      }

      var init = $q.all([getOrdersAndInvoices(), getAllVisitsWithOrders()]);
      init.then(function() {
        $scope.lines = setVisitToLines(lines, visits);
        $scope.groupedLines = sortAndGroupByVisit(lines);
      })

      $scope.initialization = init;

      var removeRetired = function() {
        lines = _.filter(lines, function(o) {
          return o.retire == false;
        })
      }

      var setVisitToLines = function(lines, visits) {
        lines.forEach(function(line) {
          visits.forEach(function(visit) {
            if (visit.order == line.order) {
              line.visit = {
                uuid: visit.uuid,
                startDate: visit.startDate,
                endDate: visit.endDate
              }
            }
          })
        })
        return lines;
      }

      var sortAndGroupByVisit = function(linesToSort) {
        return _.groupBy(
          _.orderBy(linesToSort, ['date'], ['desc']),
          function(o) {
            return new Date(o.visit.startDate).setHours(0, 0, 0, 0);
          })
      }

      var setApprovalStatusToLines = function() {
        lines.forEach(function(line) {
          line.approved = false;
          line.retire = false;
          approvedConditions.forEach(function(condition) {
            if (_.difference(condition, line.tags).length == 0) {
              line.approved = line.approved || true;
            }
          })
          nonApprovedConditions.forEach(function(condition) {
            if (_.difference(condition, line.tags).length == 0) {
              line.approved = line.approved || false;
            }
          })
          // set lines to retire
          retireLinesConditions.forEach(function(condition) {
            if (_.difference(condition, line.tags).length == 0) {
              line.retire = line.retire || true;
            }
          })
        })
      };

      var setTagsToOrderLines = function(orders) {
        orders.forEach(function(order) {
          order.order_lines.forEach(function(orderLine) {
            // NON INVOICED
            var tags = []
            tags.push(ORDER);
            if (orderLine.qty_invoiced == 0) {
              tags.push(NON_INVOICED);
            } else if (orderLine.qty_invoiced > 0 && orderLine.qty_to_invoice > 0) {
              // PARTIALLY_INVOICED
              tags.push(PARTIALLY_INVOICED);
            } else if (orderLine.qty_to_invoice <= 0) {
              // "orderLine.qty_to_invoice <= 0" for some reason the qty_to_invoice is negative.
              // FULLY_INVOICED
              tags.push(FULLY_INVOICED);
            }
            lines.push(new BillingLine(
              orderLine.id,
              order.date_order,
              null,
              order.name,
              order.x_external_order_id,
              tags,
              orderLine.display_name
            ))
          })
        })
      };

      var setTagsToInvoiceLines = function(invoices) {
        invoices.forEach(function(invoice) {
          invoice.invoice_lines.forEach(function(invoiceLine) {
            var tags = [];
            tags.push(INVOICE)
            if (invoice.state == "paid") {
              tags.push(PAID);
            } else {
              tags.push(NOT_PAID);
            }
            if (new Date(invoice.date_due).getDate() >= new Date().getDate()) {
              tags.push(OVERDUE);
            } else {
              tags.push(NOT_OVERDUE);
            }
            var orderUuid = ""
            if (invoiceLine.origin != null) {
              orders.forEach(function(order) {
                if (order.name == invoiceLine.origin) {
                  orderUuid = order.x_external_order_id;
                }
              })
            };
            lines.push(new BillingLine(
              invoiceLine.id,
              invoice.date,
              null,
              invoice.number,
              orderUuid,
              tags,
              invoiceLine.display_name
            ))
          })
          return invoices;
        });
      };
    };

    var link = function($scope, element) {
      spinner.forPromise($scope.initialization, element);
    };

    return {
      restrict: 'E',
      controller: controller,
      link: link,
      template: '<ng-include src="contentUrl"/>'
    }
  }])
