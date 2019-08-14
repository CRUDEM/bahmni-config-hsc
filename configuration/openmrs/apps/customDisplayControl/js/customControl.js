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
        uuid: "no-visit",
        startDate: null,
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

    const WS_URI = "/ws/rest/v1"

    const ERP_URI = "/erp"

    const PARTNER_URI = WS_URI + ERP_URI + "/partner"
    const ORDER_URI =  WS_URI + ERP_URI + "/order"
    const INVOICE_URI =  WS_URI + ERP_URI + "/invoice"

    this.getPartnerByUuid = function(uuid, uuidFieldName, representation) {
      var uuidFilter = {
        "field": uuidFieldName,
        "comparison": "=",
        "value": uuid
      }
      var partner = $http.post(Bahmni.Common.Constants.openmrsUrl + PARTNER_URI + "?" + $httpParamSerializer({
        rep: representation
      }), {
        filters: [uuidFilter]
      });
      return partner;
    };

    this.getOrder = function(id, representation) {
      var order = $http.get(Bahmni.Common.Constants.openmrsUrl + ORDER_URI + "/" + id + "?" + $httpParamSerializer({
        rep: representation
      }), {});
      return order;
    };

    this.getAllOrders = function(filters, representation) {
      var orders = $http.post(Bahmni.Common.Constants.openmrsUrl + ORDER_URI + "?" + $httpParamSerializer({
        rep: representation
      }), {
        filters: filters
      });
      return orders;
    };

    this.getInvoice = function(id, representation) {
      var invoice = $http.get(Bahmni.Common.Constants.openmrsUrl + INVOICE_URI + "/" + id + "?" + $httpParamSerializer({
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
      var invoices = $http.post(Bahmni.Common.Constants.openmrsUrl + INVOICE_URI + "?" + $httpParamSerializer({
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


function billingStatusController($scope, $element, erpService, visitService, appService, spinner, $q) {
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

  const retireLinesConditions = $scope.config.retireLinesConditions;
  const nonApprovedConditions = $scope.config.nonApprovedConditions;
  const approvedConditions = $scope.config.approvedConditions;
  const orderExternalIdFieldName = $scope.config.orderExternalIdFieldName;

  var invoices = [];
  var orders = [];

  var invoicesFilters = [];
  var ordersFilters = [];

  var lines = [];
  $scope.orderToInvoiceMap = {};

  var retrieveErpPartner =  function() {
      return erpService.getPartnerByUuid($scope.patient.uuid, $scope.config.patientUuidFieldName).then(function(response) {
        var patientFilter = {
          "field": "partner_id",
          "comparison": "=",
          "value": response.data[0].id
        }
        // Initialize the filters with the patient filter.
        invoicesFilters = [patientFilter];
        ordersFilters = [patientFilter];
      })
  }

  var getErpPartner = function() {
      return $q.all([retrieveErpPartner()]).then(function() {
        getOrdersAndInvoices();
      })
  }

  const erpOrderRepresentation = [
    "order_lines",
    "date",
    "date_order",
    "name",
    "number",
    orderExternalIdFieldName
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
      var orderLinesWithTags = setTagsToOrderLines(orders);
      var invoiceLinesWithTags = setTagsToInvoiceLines(invoices);
      var linesWithApprovalStatus = setApprovalStatusToLines(orderLinesWithTags.concat(invoiceLinesWithTags));
      var linesWithApprovalStatusAndRetiredValue = removeRetired(linesWithApprovalStatus);
      $scope.lines = linesWithApprovalStatusAndRetiredValue;
    });
  }

  var init = $q.all([getErpPartner()]);
  init.then(function() {
    $scope.lines = [];
  })

  $scope.initialization = init;

  var removeRetired = function(lines) {
    lines = _.filter(lines, function(o) {
      return o.retire == false;
    })
    return lines;
  }

  var setApprovalStatusToLines = function(lines) {
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
    return lines
  };

  var setTagsToOrderLines = function(orders) {
    var orderLinesWithTags = []
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
        orderLinesWithTags.push(new BillingLine(
          orderLine.id,
          order.date_order,
          null,
          order.name,
          orderLine[orderExternalIdFieldName],
          tags,
          orderLine.display_name
        ))
      })
    })
    return orderLinesWithTags;
  };

  var setTagsToInvoiceLines = function(invoices) {
    var invoiceLinesWithTags = []
    invoices.forEach(function(invoice) {
      invoice.invoice_lines.forEach(function(invoiceLine) {
        var tags = [];
        tags.push(INVOICE)
        if (invoice.state == "paid") {
          tags.push(PAID);
        } else {
          tags.push(NOT_PAID);
        }
        if (invoice.date_due != null && new Date(invoice.date_due).getDate() < new Date().getDate()) {
          tags.push(NOT_OVERDUE);
        } else {
          tags.push(OVERDUE);
        }
        var orderUuid = ""
        if (invoiceLine.origin != null) {
          orders.forEach(function(order) {
            order.order_lines.forEach(function(orderLine) {
              if (!_.isEmpty(orderLine.invoice_lines) && orderLine.invoice_lines.includes(invoiceLine.id)) {
                orderUuid = orderLine[orderExternalIdFieldName];
              }
            })
          })
        };
        invoiceLinesWithTags.push(new BillingLine(
          invoiceLine.id,
          invoice.date,
          null,
          invoice.number,
          orderUuid,
          tags,
          invoiceLine.display_name
        ))
      })
    });
    return invoiceLinesWithTags;
  };
};

angular.module('bahmni.common.displaycontrol.custom')
  .directive('billingStatus', ['erpService', 'openMRSVisitService', 'appService', 'spinner', '$q', function(erpService, visitService, appService, spinner, $q) {

    var link = function($scope, $element) {
      spinner.forPromise($scope.initialization, $element);
    };

    return {
      restrict: 'E',
      controller: ['$scope', '$element', 'erpService', 'openMRSVisitService', 'appService', 'spinner', '$q', billingStatusController],
      link: link,
      template: '<section class="dashboard-section"> \
            <h2 ng-dialog-class="ngdialog ngdialog-theme-default ng-dialog-all-details-page" ng-dialog-data=\'{"section": {{section}}, "patient": {{patient}} }\' class="section-title"> \
              <span class="title-link">{{config.translationKey | translate}} </span> \
              <i class="fa"></i> \
            </h2> \
            <div> \
              <ng-include src="contentUrl" /> \
            </div>'
    }
  }])

function billingStatusVisitController($scope, visitService, appService, $q) {

  var visits = [];

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

  var groupLinesByVisit = function(linesToGroup) {
    var groupedLines = {};
    linesToGroup.forEach(function(line) {
      if (!groupedLines[line.visit.uuid]) {
        groupedLines[line.visit.uuid] = {
          visit: line.visit,
          approved: true,
          lines: [],
        };
      }
      groupedLines[line.visit.uuid].lines.push(line)
      groupedLines[line.visit.uuid].approved = groupedLines[line.visit.uuid].approved && line.approved
    })
    return groupedLines;
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
              endDate: visit.stopDatetime
            })
          })
        })
      });
      visits = flat;
    })
  }

  var init = $q.all([getAllVisitsWithOrders()])
  init.then(function() {
    $scope.lines = setVisitToLines($scope.lines, visits);
    $scope.groupedlines = groupLinesByVisit($scope.lines);
  })

  $scope.initialization = init;
}

angular.module('bahmni.common.displaycontrol.custom')
  .directive('billingStatusVisit', ['openMRSVisitService', 'appService', 'spinner', '$q', function(visitService, appService, spinner, $q) {

    var link = function($scope, $element) {
      $scope.contentUrl = appService.configBaseUrl() + "/customDisplayControl/views/billingStatusVisit.html";
      spinner.forPromise($scope.initialization, $element);
    }

    return {
      link: link,
      restrict: 'E',
      scope: {
        lines: '=lines',
        patient: '=patient'
      },
      controller: ['$scope', 'openMRSVisitService', 'appService', '$q', billingStatusVisitController],
      template: '<div><ng-include src="contentUrl" /></div>'
    }
  }])
