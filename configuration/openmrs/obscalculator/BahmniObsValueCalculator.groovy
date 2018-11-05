import org.apache.commons.lang.StringUtils
import org.hibernate.Query
import org.hibernate.SessionFactory
import org.openmrs.Obs
import org.openmrs.Patient
import org.openmrs.module.bahmniemrapi.encountertransaction.contract.BahmniObservation
import org.openmrs.util.OpenmrsUtil;
import org.openmrs.api.context.Context
import org.openmrs.module.bahmniemrapi.obscalculator.ObsValueCalculator;
import org.openmrs.module.bahmniemrapi.encountertransaction.contract.BahmniEncounterTransaction
import org.openmrs.module.emrapi.encounter.domain.EncounterTransaction;

import org.joda.time.LocalDate;
import org.joda.time.Months;

public class BahmniObsValueCalculator implements ObsValueCalculator {

    static Double BMI_VERY_SEVERELY_UNDERWEIGHT = 16.0;
    static Double BMI_SEVERELY_UNDERWEIGHT = 17.0;
    static Double BMI_UNDERWEIGHT = 18.5;
    static Double BMI_NORMAL = 25.0;
    static Double BMI_OVERWEIGHT = 30.0;
    static Double BMI_OBESE = 35.0;
    static Double BMI_SEVERELY_OBESE = 40.0;
    static Double ZERO = 0.0;
    static Map<BahmniObservation, BahmniObservation> obsParentMap = new HashMap<BahmniObservation, BahmniObservation>();

    public static enum BmiStatus {
        VERY_SEVERELY_UNDERWEIGHT("Very Severely Underweight"),
        SEVERELY_UNDERWEIGHT("Severely Underweight"),
        UNDERWEIGHT("Underweight"),
        NORMAL("Normal"),
        OVERWEIGHT("Overweight"),
        OBESE("Obese"),
        SEVERELY_OBESE("Severely Obese"),
        VERY_SEVERELY_OBESE("Very Severely Obese"),
        NEG30plus("below -3"),
        NEG30("-3"),
        NEG25("-2.5"),
        NEG20("-2"),
        NEG15("-1.5"),
        NEG10("-1"),
        NEG05("-0.5"),
        P00("0"),
        P05("0.5"),
        P10("1"),
        P15("1.5"),
        P20("2"),
        P25("2.5"),
        P30("3"),
        P30plus("above 3");

        private String status;

        BmiStatus(String status) {
            this.status = status
        }

        @Override
        public String toString() {
            return status;
        }
    }


    public void run(BahmniEncounterTransaction bahmniEncounterTransaction) {
        calculateAndAdd(bahmniEncounterTransaction);
    }

    static def calculateAndAdd(BahmniEncounterTransaction bahmniEncounterTransaction) {
        Collection<BahmniObservation> observations = bahmniEncounterTransaction.getObservations()
        def nowAsOfEncounter = bahmniEncounterTransaction.getEncounterDateTime() != null ? bahmniEncounterTransaction.getEncounterDateTime() : new Date();

        BahmniObservation heightObservation = find("Height", observations, null)
        BahmniObservation weightObservation = find("Weight", observations, null)
        BahmniObservation parent = null;

        if (hasValue(heightObservation) || hasValue(weightObservation)) {
            BahmniObservation bmiDataObservation = find("BMI Data", observations, null)
            BahmniObservation bmiObservation = find("BMI", bmiDataObservation ? [bmiDataObservation] : [], null)
            BahmniObservation bmiAbnormalObservation = find("BMI Abnormal", bmiDataObservation ? [bmiDataObservation]: [], null)

            BahmniObservation bmiStatusDataObservation = find("BMI Status Data", observations, null)
            BahmniObservation bmiStatusObservation = find("BMI Status", bmiStatusDataObservation ? [bmiStatusDataObservation] : [], null)
            BahmniObservation bmiStatusAbnormalObservation = find("BMI Status Abnormal", bmiStatusDataObservation ? [bmiStatusDataObservation]: [], null)

            Patient patient = Context.getPatientService().getPatientByUuid(bahmniEncounterTransaction.getPatientUuid())
            def patientAgeInMonthsAsOfEncounter = Months.monthsBetween(new LocalDate(patient.getBirthdate()), new LocalDate(nowAsOfEncounter).plusDays(15)).getMonths()

            parent = obsParent(heightObservation, parent)
            parent = obsParent(weightObservation, parent)

            if ((heightObservation && heightObservation.voided) && (weightObservation && weightObservation.voided)) {
                voidObs(bmiDataObservation);
                voidObs(bmiObservation);
                voidObs(bmiStatusDataObservation);
                voidObs(bmiStatusObservation);
                voidObs(bmiAbnormalObservation);
                return
            }

            def previousHeightValue = fetchLatestValue("Height", bahmniEncounterTransaction.getPatientUuid(), heightObservation, nowAsOfEncounter)
            def previousWeightValue = fetchLatestValue("Weight", bahmniEncounterTransaction.getPatientUuid(), weightObservation, nowAsOfEncounter)

            Double height = hasValue(heightObservation) && !heightObservation.voided ? heightObservation.getValue() as Double : previousHeightValue
            Double weight = hasValue(weightObservation) && !weightObservation.voided ? weightObservation.getValue() as Double : previousWeightValue
            Date obsDatetime = getDate(weightObservation) != null ? getDate(weightObservation) : getDate(heightObservation)

            if (height == null || weight == null) {
                voidObs(bmiDataObservation)
                voidObs(bmiObservation)
                voidObs(bmiStatusDataObservation)
                voidObs(bmiStatusObservation)
                voidObs(bmiAbnormalObservation)
                return
            }

            bmiDataObservation = bmiDataObservation ?: createObs("BMI Data", null, bahmniEncounterTransaction, obsDatetime) as BahmniObservation
            bmiStatusDataObservation = bmiStatusDataObservation ?: createObs("BMI Status Data", null, bahmniEncounterTransaction, obsDatetime) as BahmniObservation

            def bmi = bmi(height, weight)
            bmiObservation = bmiObservation ?: createObs("BMI", bmiDataObservation, bahmniEncounterTransaction, obsDatetime) as BahmniObservation;
            bmiObservation.setValue(bmi);

            def bmiStatus = bmiStatus(bmi, patientAgeInMonthsAsOfEncounter, patient.getGender());
            bmiStatusObservation = bmiStatusObservation ?: createObs("BMI Status", bmiStatusDataObservation, bahmniEncounterTransaction, obsDatetime) as BahmniObservation;
            bmiStatusObservation.setValue(bmiStatus);

            def bmiAbnormal = bmiAbnormal(bmiStatus);
            bmiAbnormalObservation =  bmiAbnormalObservation ?: createObs("BMI Abnormal", bmiDataObservation, bahmniEncounterTransaction, obsDatetime) as BahmniObservation;
            bmiAbnormalObservation.setValue(bmiAbnormal);

            bmiStatusAbnormalObservation =  bmiStatusAbnormalObservation ?: createObs("BMI Status Abnormal", bmiStatusDataObservation, bahmniEncounterTransaction, obsDatetime) as BahmniObservation;
            bmiStatusAbnormalObservation.setValue(bmiAbnormal);

            return
        }

        BahmniObservation waistCircumferenceObservation = find("Waist Circumference", observations, null)
        BahmniObservation hipCircumferenceObservation = find("Hip Circumference", observations, null)
        if (hasValue(waistCircumferenceObservation) && hasValue(hipCircumferenceObservation)) {
            def calculatedConceptName = "Waist/Hip Ratio"
            BahmniObservation calculatedObs = find(calculatedConceptName, observations, null)
            parent = obsParent(waistCircumferenceObservation, null)

            Date obsDatetime = getDate(waistCircumferenceObservation)
            def waistCircumference = waistCircumferenceObservation.getValue() as Double
            def hipCircumference = hipCircumferenceObservation.getValue() as Double
            def waistByHipRatio = waistCircumference/hipCircumference
            if (calculatedObs == null)
                calculatedObs = createObs(calculatedConceptName, parent, bahmniEncounterTransaction, obsDatetime) as BahmniObservation

            calculatedObs.setValue(waistByHipRatio)
            return
        }

        BahmniObservation lmpObservation = find("Obstetrics, Last Menstrual Period", observations, null)
        def calculatedConceptName = "Estimated Date of Delivery"
        if (hasValue(lmpObservation)) {
            parent = obsParent(lmpObservation, null)
            def calculatedObs = find(calculatedConceptName, observations, null)

            Date obsDatetime = getDate(lmpObservation)

            LocalDate edd = new LocalDate(lmpObservation.getValue()).plusMonths(9).plusWeeks(1)
            if (calculatedObs == null)
                calculatedObs = createObs(calculatedConceptName, parent, bahmniEncounterTransaction, obsDatetime) as BahmniObservation
            calculatedObs.setValue(edd)
            return
        } else {
            def calculatedObs = find(calculatedConceptName, observations, null)
            if (hasValue(calculatedObs)) {
                voidObs(calculatedObs)
            }
        }
    }

    private static BahmniObservation obsParent(BahmniObservation child, BahmniObservation parent) {
        if (parent != null) return parent;

        if(child != null) {
            return obsParentMap.get(child)
        }
    }

    private static Date getDate(BahmniObservation observation) {
        return hasValue(observation) && !observation.voided ? observation.getObservationDateTime() : null;
    }

    private static boolean hasValue(BahmniObservation observation) {
        return observation != null && observation.getValue() != null && !StringUtils.isEmpty(observation.getValue().toString());
    }

    private static void voidObs(BahmniObservation bmiObservation) {
        if (hasValue(bmiObservation)) {
            bmiObservation.voided = true
        }
    }

    static BahmniObservation createObs(String conceptName, BahmniObservation parent, BahmniEncounterTransaction encounterTransaction, Date obsDatetime) {
        def concept = Context.getConceptService().getConceptByName(conceptName)
        BahmniObservation newObservation = new BahmniObservation()
        newObservation.setConcept(new EncounterTransaction.Concept(concept.getUuid(), conceptName))
        newObservation.setObservationDateTime(obsDatetime);
        parent == null ? encounterTransaction.addObservation(newObservation) : parent.addGroupMember(newObservation)
        return newObservation
    }

    static def bmi(Double height, Double weight) {
        if (height == ZERO) {
            throw new IllegalArgumentException("Please enter Height greater than zero")
        } else if (weight == ZERO) {
            throw new IllegalArgumentException("Please enter Weight greater than zero")
        }
        Double heightInMeters = height / 100;
        Double value = weight / (heightInMeters * heightInMeters);
        return new BigDecimal(value).setScale(2, BigDecimal.ROUND_HALF_UP).doubleValue();
    };

    static def bmiStatus(Double bmi, Integer ageInMonth, String gender) {
        BMIChart bmiChart = readCSV(OpenmrsUtil.getApplicationDataDirectory() + "obscalculator/BMI_chart_SD.csv");
        def bmiChartLine = bmiChart.get(gender, ageInMonth);
        if(bmiChartLine != null ) {
            return bmiChartLine.getStatus(bmi);
        }

        if (bmi < BMI_VERY_SEVERELY_UNDERWEIGHT) {
            return BmiStatus.VERY_SEVERELY_UNDERWEIGHT;
        }
        if (bmi < BMI_SEVERELY_UNDERWEIGHT) {
            return BmiStatus.SEVERELY_UNDERWEIGHT;
        }
        if (bmi < BMI_UNDERWEIGHT) {
            return BmiStatus.UNDERWEIGHT;
        }
        if (bmi < BMI_NORMAL) {
            return BmiStatus.NORMAL;
        }
        if (bmi < BMI_OVERWEIGHT) {
            return BmiStatus.OVERWEIGHT;
        }
        if (bmi < BMI_OBESE) {
            return BmiStatus.OBESE;
        }
        if (bmi < BMI_SEVERELY_OBESE) {
            return BmiStatus.SEVERELY_OBESE;
        }
        if (bmi >= BMI_SEVERELY_OBESE) {
            return BmiStatus.VERY_SEVERELY_OBESE;
        }
        return null
    }

    static def bmiAbnormal(BmiStatus status) {
        return status != BmiStatus.NORMAL;
    };

    static Double fetchLatestValue(String conceptName, String patientUuid, BahmniObservation excludeObs, Date tillDate) {
        SessionFactory sessionFactory = Context.getRegisteredComponents(SessionFactory.class).get(0)
        def excludedObsIsSaved = excludeObs != null && excludeObs.uuid != null
        String excludeObsClause = excludedObsIsSaved ? " and obs.uuid != :excludeObsUuid" : ""
        Query queryToGetObservations = sessionFactory.getCurrentSession()
                .createQuery("select obs " +
                " from Obs as obs, ConceptName as cn " +
                " where obs.person.uuid = :patientUuid " +
                " and cn.concept = obs.concept.conceptId " +
                " and cn.name = :conceptName " +
                " and obs.voided = false" +
                " and obs.obsDatetime <= :till" +
                excludeObsClause +
                " order by obs.obsDatetime desc ");
        queryToGetObservations.setString("patientUuid", patientUuid);
        queryToGetObservations.setParameterList("conceptName", conceptName);
        queryToGetObservations.setParameter("till", tillDate);
        if (excludedObsIsSaved) {
            queryToGetObservations.setString("excludeObsUuid", excludeObs.uuid)
        }
        queryToGetObservations.setMaxResults(1);
        List<Obs> observations = queryToGetObservations.list();
        if (observations.size() > 0) {
            return observations.get(0).getValueNumeric();
        }
        return null
    }

    static BahmniObservation find(String conceptName, Collection<BahmniObservation> observations, BahmniObservation parent) {
        for (BahmniObservation observation : observations) {
            if (conceptName.equalsIgnoreCase(observation.getConcept().getName())) {
                obsParentMap.put(observation, parent);
                return observation;
            }
            BahmniObservation matchingObservation = find(conceptName, observation.getGroupMembers(), observation)
            if (matchingObservation) return matchingObservation;
        }
        return null
    }

    static BMIChart readCSV(String fileName) {
        def chart = new BMIChart();
        try {
            new File(fileName).withReader { reader ->
                def header = reader.readLine();
                reader.splitEachLine(",") { tokens ->
                    chart.add(new BMIChartLine(tokens[0], tokens[1], tokens[2], tokens[3], tokens[4], tokens[5], tokens[6], tokens[7], tokens[8], tokens[9],tokens[10], tokens[11], tokens[12], tokens[13], tokens[14], tokens[15]));
                }
            }
        } catch (FileNotFoundException e) {
        }
        return chart;
    }

    static class BMIChartLine {
        public String gender;
        public Integer ageInMonth;
        public Double sd30negplus;
        public Double sd30neg;
        public Double sd25neg;
        public Double sd20neg;
        public Double sd15neg;
        public Double sd10neg;
        public Double sd05neg;
        public Double sd00;
        public Double sd05;
        public Double sd10;
        public Double sd15;
        public Double sd20;
        public Double sd25;
        public Double sd30;

        BMIChartLine(String gender, String ageInMonth, String sd30negplus, String sd30neg, String sd25neg, String sd20neg, String sd15neg, String sd10neg,String sd05neg, String sd00, String sd05, String sd10, String sd15, String sd20, String sd25, String sd30) {
            this.gender = gender
            this.ageInMonth = ageInMonth.toInteger();
            this.sd30negplus = sd30negplus.toDouble();
            this.sd30neg = sd30neg.toDouble();
            this.sd25neg = sd25neg.toDouble();
            this.sd20neg = sd20neg.toDouble();
            this.sd15neg = sd15neg.toDouble();
            this.sd10neg = sd10neg.toDouble();
            this.sd05neg = sd05neg.toDouble();
            this.sd00 = sd00.toDouble();
            this.sd05 = sd05.toDouble();
            this.sd10 = sd10.toDouble();
            this.sd15 = sd15.toDouble();
            this.sd20 = sd20.toDouble();
            this.sd25 = sd25.toDouble();
            this.sd30 = sd30.toDouble();
        }

        public BmiStatus getStatus(Double bmi) {
            if(bmi < sd30negplus) {
                return BmiStatus.NEG30plus
            } else if(bmi < sd30neg) {
                return BmiStatus.NEG30
            } else if(bmi < sd25neg) {
                return BmiStatus.NEG25
            } else if(bmi < sd20neg) {
                return BmiStatus.NEG20
            } else if(bmi < sd15neg) {
                return BmiStatus.NEG15
            } else if(bmi < sd10neg) {
                return BmiStatus.NEG10
            } else if(bmi < sd05neg) {
                return BmiStatus.NEG05
            } else if(bmi < sd00) {
                return BmiStatus.P00
            } else if(bmi < sd05) {
                return BmiStatus.P05
            } else if(bmi < sd10) {
                return BmiStatus.P10
            } else if(bmi < sd15) {
                return BmiStatus.P15
            } else if(bmi < sd20) {
                return BmiStatus.P20
            } else if(bmi < sd25) {
                return BmiStatus.P25
            } else if(bmi < sd30) {
                return BmiStatus.P30
            } else {
                return BmiStatus.P30plus
            }
        }
    }

    static class BMIChart {
        List<BMIChartLine> lines;
        Map<BMIChartLineKey, BMIChartLine> map = new HashMap<BMIChartLineKey, BMIChartLine>();

        public add(BMIChartLine line) {
            def key = new BMIChartLineKey(line.gender, line.ageInMonth);
            map.put(key, line);
        }

        public BMIChartLine get(String gender, Integer ageInMonth) {
            def key = new BMIChartLineKey(gender, ageInMonth);
            return map.get(key);
        }
    }

    static class BMIChartLineKey {
        public String gender;
        public Integer ageInMonth;

        BMIChartLineKey(String gender, Integer ageInMonth) {
            this.gender = gender
            this.ageInMonth = ageInMonth
        }

        boolean equals(o) {
            if (this.is(o)) return true
            if (getClass() != o.class) return false

            BMIChartLineKey bmiKey = (BMIChartLineKey) o

            if (ageInMonth != bmiKey.ageInMonth) return false
            if (gender != bmiKey.gender) return false

            return true
        }

        int hashCode() {
            int result
            result = (gender != null ? gender.hashCode() : 0)
            result = 31 * result + (ageInMonth != null ? ageInMonth.hashCode() : 0)
            return result
        }
    }
}
