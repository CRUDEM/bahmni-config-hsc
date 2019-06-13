'use strict';
angular.module('bahmni.common.displaycontrol.custom')
  .service('erpService', ['$http', '$httpParamSerializer', 'sessionService', function($http, $httpParamSerializer, sessionService) {

    this.getOrder = function(id, representation) {
      var order = $http.get(Bahmni.Common.Constants.openmrsUrl + "/ws/rest/v1/erp/order/" + id + "?" + $httpParamSerializer({
        rep: representation
      }), {});
      return order;
    };

    this.getAllOrders = function(filters, representation) {
      var patientFilter = {
        "field": "uuid",
        "comparison": "=",
        "value": ""
      }
      // filters.push(patientFilter)
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
      var patientFilter = {
        "field": "uuid",
        "comparison": "=",
        "value": ""
      }
      // filters.push(patientFilter)
      var salesInvoiceFilter = {
        "field": "type",
        "comparison": "=",
        "value": "out_invoice"
      }
      filters.push(salesInvoiceFilter)
      var invoices = $http.post(Bahmni.Common.Constants.openmrsUrl + "/ws/rest/v1/erp/invoice?" + $httpParamSerializer({
        rep: representation
      }), {
        params: {
          rep: "full"
        },
        filters: filters
      });
      return invoices;
    };

  }]);

angular.module('bahmni.common.displaycontrol.custom')
  .directive('billingStatus', ['erpService', 'appService', 'spinner', '$q', function(erpService, appService, spinner, $q) {
    var link = function($scope) {

      $scope.contentUrl = appService.configBaseUrl() + "/customDisplayControl/views/billingStatus.html";

      var lines = [];
      $scope.lines = [];
      $scope.debug = [];

      const ORDER = "ORDER"
      const INVOICE = "INVOICE"

      const NON_INVOICED = "NON INVOICED"
      const FULLY_INVOICED = "FULLY_INVOICED"
      const PARTIALLY_INVOICED = "PARTIALLY_INVOICED"

      const PAID = "PAID"
      const NOT_PAID = "NOT_PAID"

      const OVERDUE = "OVERDUE"
      const NOT_OVERDUE = "NOT_OVERDUE"

      var retireLinesConditions = $scope.config.retireLinesConditions
      var nonApprovedConditions = $scope.config.nonApprovedConditions
      var approvedConditions = $scope.config.approvedConditions

      var ordersFilters = [];
      var invoicesFilters = [];

      erpService.getAllOrders(ordersFilters, "full").success(function(orders) {
        erpService.getAllInvoices(invoicesFilters, "full").success(function(invoices) {
          setTagsToOrderLines(orders);
          setTagsToInvoiceLines(invoices);
          setApprovalStatusToLines();
          $scope.lines = lines;
        });
      });

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
          order.order_lines.forEach(function(line) {
            // NON INVOICED
            var tags = []
            tags.push(ORDER);
            if (line.qty_invoiced == 0) {
              tags.push(NON_INVOICED);
            } else if (line.qty_invoiced != 0 && line.qty_to_invoice != 0) {
              // PARTIALLY_INVOICED
              tags.push(PARTIALLY_INVOICED);
            } else if (line.qty_to_invoice == 0) {
              // FULLY_INVOICED
              tags.push(FULLY_INVOICED);
            }
            lines.push({
              "id": line.id,
              "date": order.date_order,
              "document": order.name,
              "tags": tags,
              "displayName": line.display_name
            })
          })
        })
        return orders;
      };

      var setTagsToInvoiceLines = function(invoices) {
        invoices.forEach(function(invoice) {
          invoice.invoice_lines.forEach(function(line) {
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
            lines.push({
              "id": line.id,
              "date": invoice.date,
              "document": invoice.number,
              "tags": tags,
              "displayName": line.display_name
            })
          })
          return invoices;
        });
      };
    }
    return {
      restrict: 'E',
      link: link,
      template: '<ng-include src="contentUrl"/>'
    }
  }])
